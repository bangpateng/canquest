import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { CantonWalletSdkService } from './wallet-sdk.service';
import { CantonLedgerService } from './canton-ledger.service';
import { SpliceValidatorService } from './splice-validator.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { hasRealWallet } from '../common/wallet-policy';
import { ClaimOfferService } from './v30/claim-offer.service';
import { LockProposalService } from './v30/lock-proposal.service';
import {
  cantonPartyIdsEqual,
  looksLikeCantonPartyId,
  normalizeCantonPartyId,
} from '../common/canton-party-id';

/**
 * SigningRelayService — relay tanda tangan transaksi user external (M3).
 *
 * Pola (kunci private tidak pernah keluar browser):
 *   1. prepare(userId, flow, params)
 *      Backend membangun command persis seperti jalur custodial, lalu memanggil
 *      interactive-submission/prepare via wallet-sdk. Hash transaksi
 *      dikembalikan ke browser. Objek prepared disimpan in-memory (TTL 10 menit).
 *   2. Browser: signPreparedHash(hash) — signature Ed25519 dari kunci user.
 *   3. execute(userId, signature)
 *      ledger.fromSignature(prepareResponse, signature) → executeAndWait.
 *
 * Tervalidasi MainNet (M3 spike): jalur fromSignature+execute menghasilkan
 * updateId untuk party external yang sudah ber-rights.
 *
 * Flow yang didukung (bertambah bertahap):
 *   - wallet_registration_accept: operator create WalletRegistrationProposal
 *     (idempoten) → user sign Accept → WalletRegistration aktif on-chain.
 *     Inilah pengganti recordPartyRegistration custodial untuk user external.
 */

const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingSigning {
  userId: string;
  flow: string;
  partyId: string;
  commandId: string;
  // PreparedTransaction SDK — objek hidup antar panggilan prepare→execute.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepared: any;
  /** Meta khusus flow (amount, recipient, fee, dst.) — dipakai bookkeeping execute. */
  meta: Record<string, unknown>;
  createdAt: number;
}

/** Hasil builder flow: command(s) siap-prepare + bookkeeping meta. */
interface BuiltFlow {
  commands: unknown[];
  disclosedContracts?: unknown[];
  commandId?: string;
  meta?: Record<string, unknown>;
  description?: string;
  /**
   * Rantai fallback bila prepare attempt utama DITOLAK participant (mis.
   * multi-command belum didukung → turun ke WUP batch → legacy single).
   * Dicoba berurutan; attempt pertama yang lolos prepare yang dipakai.
   */
  fallback?: BuiltFlow;
}

/** Variant sukses buildFactoryTransferCommands (union narrowed ke ok:true). */
type FactoryMultiBuild = Extract<
  Awaited<ReturnType<CantonLedgerService['buildFactoryTransferCommands']>>,
  { ok: true }
>;

@Injectable()
export class SigningRelayService {
  private readonly logger = new Logger(SigningRelayService.name);
  private readonly pending = new Map<string, PendingSigning>();
  /**
   * True = LEWATI attempt multi-command (2× TransferFactory_Transfer dalam
   * satu prepare). Default true: node produksi (Splice 0.6.12 / Canton 3.4)
   * TERBUKTI menolak — "Preparing multiple commands is currently not
   * supported" (MainNet 2026-08-29). Set QUEST_TRY_MULTI_COMMAND=true utk
   * re-probe (mis. setelah upgrade node — pola canton-loop 2 ROOT event).
   * Sekali participant menerima, error-handler di bawah memflip flag ini.
   */
  private multiCommandRejected = true;

  constructor(
    private readonly sdkProvider: CantonWalletSdkService,
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly claimOffers: ClaimOfferService,
    private readonly lockProposals: LockProposalService,
  ) {
    // Opt-in re-probe multi-command (default skip — node Splice 0.6.12 menolak).
    if (this.config.get<string>('QUEST_TRY_MULTI_COMMAND') === 'true') {
      this.multiCommandRejected = false;
    }
  }

  private get packagePrefix(): string {
    return this.config.get<string>('CANTON_DAML_PACKAGE_NAME') || '#canquest-v29';
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.pending) {
      if (now - entry.createdAt > PENDING_TTL_MS) this.pending.delete(key);
    }
  }

  /** User harus punya wallet external untuk memakai relay. */
  private async requireExternalUser(userId: string): Promise<{
    userId: string;
    partyId: string;
    username: string | null;
  }> {
    const user = await this.users.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    if (!hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException('No wallet yet — complete onboarding first.');
    }
    if (user.walletKind && user.walletKind !== 'external') {
      throw new BadRequestException(
        'Your wallet is still custodial — the signing relay is only for non-custodial wallets.',
      );
    }
    return { userId, partyId: user.cantonPartyId!, username: user.username };
  }

  /**
   * Langkah 1 — siapkan transaksi untuk ditandatangani browser.
   * Return hash (base64) yang harus di-sign user.
   */
  async prepare(
    userId: string,
    flow: string,
    params: Record<string, unknown>,
  ): Promise<{
    flow: string;
    hash: string;
    commandId: string;
    description: string;
  }> {
    this.sweepExpired();
    if (this.pending.has(userId)) {
      throw new BadRequestException(
        'A transaction is already awaiting your signature — complete it first.',
      );
    }

    const user = await this.requireExternalUser(userId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builders: Record<string, (u: typeof user, p: Record<string, unknown>) => Promise<BuiltFlow>> = {
      wallet_registration_accept: (u) => this.buildWalletRegistrationAccept(u),
      send_cc: (u, p) => this.buildSendCc(u, p),
      send_token: (u, p) => this.buildSendToken(u, p),
      accept_offer: (u, p) => this.buildOfferAction(u, p, 'accept'),
      reject_offer: (u, p) => this.buildOfferAction(u, p, 'reject'),
      withdraw_offer: (u, p) => this.buildOfferAction(u, p, 'withdraw'),
      lock_cc: (u, p) => this.buildLockCc(u, p),
      unlock_cc: (u, p) => this.buildUnlockCc(u, p),
      // Preapproval TOKEN REGISTRY (USDCx) — P2P one-step via CIP-0056 generic.
      // Berbeda dari CC (jalur validator setup-proposal, controller M5b):
      // template Utility.Registry.App.V0.Model.TransferPreapproval,
      // signatory = receiver → create/Archive cukup signature user.
      usdcx_preapproval_enable: (u) => this.buildRegistryPreapprovalEnable(u),
      usdcx_preapproval_disable: (u) => this.buildRegistryPreapprovalDisable(u),
      // ── v30 (canquest-claim / canquest-lock) ──
      // SATU ExerciseCommand per submission (batas external party — node
      // produksi juga menolak multi-command). Otoritas rewardSender pada
      // Accept* diwarisi dari signatory ClaimOffer, BUKAN actAs tambahan.
      accept_claim_offer: (u, p) => this.claimOffers.buildAcceptClaimOffer(u.userId, p),
      accept_lock_proposal: (u, p) => this.lockProposals.buildAcceptLockProposal(u.userId, p),
      // NOTE: preapproval_enable/disable TIDAK dibuat utk user external —
      // terbukti MainNet (spike-m3c): AmuletRules_CreateTransferPreapproval
      // mewajibkan co-authorizer provider; interactive submission hanya
      // membawa tanda tangan pemilik kunci → DAML_AUTHORIZATION_ERROR.
      // External users: transfer masuk via offer + sign-accept (by design).
    };
    const builder = builders[flow];
    if (!builder) {
      throw new BadRequestException(`Flow '${flow}' is not supported yet.`);
    }

    const built = await builder(user, params);
    return this.prepareWithCommands(userId, flow, built.commands, {
      disclosedContracts: built.disclosedContracts,
      commandId: built.commandId,
      meta: built.meta,
      description: built.description,
      partyId: user.partyId,
      fallback: built.fallback,
    });
  }

  /**
   * Prepare generik dengan command PRA-DIBANGUN — dipakai flow yang builder-nya
   * hidup di service lain (mis. QuestsService.prepareExternalFcfsClaimFee;
   * hindari circular dependency module). Hanya utk user external.
   *
   * `opts.fallback`: rantai BuiltFlow alternatif bila attempt utama ditolak
   * participant saat prepare (belum ada dana bergerak — prepare hanya menghitung
   * hash). Dicoba berurutan sampai ada yang lolos; meta/description attempt
   * yang lolos yang dipakai untuk bookkeeping execute.
   */
  async prepareWithCommands(
    userId: string,
    flow: string,
    commands: unknown[],
    opts?: {
      disclosedContracts?: unknown[];
      commandId?: string;
      meta?: Record<string, unknown>;
      description?: string;
      partyId?: string;
      fallback?: BuiltFlow;
    },
  ): Promise<{ flow: string; hash: string; commandId: string; description: string }> {
    this.sweepExpired();
    if (this.pending.has(userId)) {
      throw new BadRequestException(
        'A transaction is already awaiting your signature — complete it first.',
      );
    }

    const user = opts?.partyId
      ? { userId, partyId: opts.partyId, username: null }
      : await this.requireExternalUser(userId);

    const attempts: BuiltFlow[] = [
      {
        commands,
        disclosedContracts: opts?.disclosedContracts,
        commandId: opts?.commandId,
        meta: opts?.meta,
        description: opts?.description,
      },
    ];
    for (let fb = opts?.fallback; fb; fb = fb.fallback) attempts.push(fb);

    const sdk = await this.sdkProvider.getSdk();
    let lastErr: unknown;
    for (const attempt of attempts) {
      const commandId = `relay-${flow}-${attempt.commandId ?? randomUUID()}`;
      try {
        const prepared = sdk.ledger.prepare({
          partyId: user.partyId,
          commands: attempt.commands,
          commandId,
          ...(attempt.disclosedContracts?.length
            ? { disclosedContracts: attempt.disclosedContracts as never }
            : {}),
        });
        const response = await prepared.preparedPromise;

        this.pending.set(userId, {
          userId,
          flow,
          partyId: user.partyId,
          commandId,
          prepared,
          meta: attempt.meta ?? {},
          createdAt: Date.now(),
        });

        this.logger.log(
          `prepare flow=${flow} user=${userId.slice(0, 8)}… hash=${response.preparedTransactionHash.slice(0, 12)}… (${attempts.length > 1 ? `attempt ${commandId.slice(6, 30)}` : 'single attempt'})`,
        );
        return {
          flow,
          hash: response.preparedTransactionHash,
          commandId,
          description: attempt.description ?? flow,
        };
      } catch (err) {
        lastErr = err;
        const cause = String((err as { cause?: string })?.cause ?? err);
        if (/multiple commands|single command/i.test(cause)) {
          // Participant menolak >1 command — catat agar attempt multi-command
          // berikutnya dilewati (hemat latensi), lalu turuni rantai fallback.
          this.multiCommandRejected = true;
          this.logger.warn(
            `Participant rejected multi-command prepare — flag ON, falling back: ${cause.slice(0, 180)}`,
          );
        } else {
          this.logger.warn(
            `prepare attempt failed (${commandId.slice(6, 40)}): ${cause.slice(0, 180)}`,
          );
        }
      }
    }
    throw lastErr ?? new Error('prepare failed');
  }

  /**
   * Langkah 2 — submit dengan signature browser.
   * Return updateId on-chain.
   */
  async execute(
    userId: string,
    signatureB64: string,
  ): Promise<{ updateId?: string; completionOffset?: number; flow: string }> {
    const entry = this.pending.get(userId);
    if (!entry) {
      throw new BadRequestException(
        'No transaction awaiting signature (TTL 10 minutes) — run prepare again.',
      );
    }
    if (typeof signatureB64 !== 'string' || signatureB64.length < 16) {
      throw new BadRequestException('Invalid signature.');
    }

    const sdk = await this.sdkProvider.getSdk();
    const response = await entry.prepared.preparedPromise;
    let result: { updateId?: string; completionOffset?: number } | undefined;
    try {
      const signed = sdk.ledger.fromSignature(response, signatureB64);
      result = await sdk.ledger.execute(signed, {
        partyId: entry.partyId,
        submissionId: entry.commandId,
      });
    } catch (err) {
      // Jangan biarkan pending stuck — participant sudah menolak, prepare ulang.
      this.pending.delete(userId);
      const cause = String((err as { cause?: string })?.cause ?? err);
      if (/0 valid signatures/i.test(cause)) {
        throw new BadRequestException(
          'Signature rejected — your wallet key does not match this wallet on-chain. ' +
            'Restore your original key via Settings → Restore from Backup Key.',
        );
      }
      throw err;
    }
    this.pending.delete(userId);
    this.logger.log(
      `execute flow=${entry.flow} user=${userId.slice(0, 8)}… updateId=${String(result?.updateId ?? '?').slice(0, 16)}…`,
    );

    // Bookkeeping pasca-eksekusi — mirror pola party-transfer.controller
    // (kegagalan DB TIDAK boleh menyesatkan user: transaksi on-chain sudah nyata).
    await this.postExecuteBookkeeping(entry, result).catch((err) => {
      this.logger.error(
        `postExecuteBookkeeping flow=${entry.flow} error: ${String(err).slice(0, 160)}`,
      );
    });

    return {
      updateId: result?.updateId,
      completionOffset: result?.completionOffset,
      flow: entry.flow,
    };
  }

  /**
   * Bookkeeping per-flow setelah execute sukses.
   * send_cc → baris TRANSFER_OUT (transfer + fee), pola audit-trail-loss:
   * ledger sudah sukses → kegagalan record hanya di-log keras, tidak throw.
   */
  private async postExecuteBookkeeping(
    entry: PendingSigning,
    result: { updateId?: string } | undefined,
  ): Promise<void> {
    // Offers: flip baris PENDING sesuai hasil (mirror doAccept/doReject inbox).
    if (entry.flow === 'accept_offer' || entry.flow === 'reject_offer') {
      const meta = entry.meta as { cid: string };
      try {
        await this.users.markTransferInstructionSettled(
          meta.cid,
          entry.flow === 'accept_offer' ? 'COMPLETED' : 'REJECTED',
          result?.updateId,
        );

        // ACCEPT: buat juga record + notifikasi utk PENERIMA (receiver).
        // markTransferInstructionSettled hanya update row SENDER — receiver
        // tidak mendapat TRANSFER_IN apa pun → badge tidak muncul.
        if (entry.flow === 'accept_offer') {
          const offerMeta = entry.meta as {
            cid: string;
            offer?: {
              amount: string;
              instrumentId: string;
              instrumentAdmin: string;
              sender: string;
            } | null;
          };
          await this.recordReceiverAccept(
            meta.cid,
            entry.userId,
            result?.updateId,
            offerMeta.offer ?? null,
          );
        }
      } catch (err) {
        this.logger.warn(
          `markTransferInstructionSettled (${entry.flow}) gagal: ${String(err).slice(0, 120)}`,
        );
      }
      return;
    }

    // Lock: metadata ccLock + history — mirror party-lock.controller (on-chain
    // sudah nyata; kegagalan DB hanya di-log, reconciler akan backfill).
    if (entry.flow === 'lock_cc') {
      const meta = entry.meta as {
        amountCc: number;
        termKey: string;
        seconds: number;
        expiresAt: string;
      };
      try {
        // Cari LockedAmulet baru milik user (match expiresAt ±5s) — mirror
        // pola ambiguity-resolution lockCc.
        const locks = await this.ledger
          .findLockedAmulets(entry.partyId)
          .catch(() => []);
        const match = locks.find(
          (l) =>
            l.expiresAt &&
            Math.abs(Date.parse(l.expiresAt) - Date.parse(meta.expiresAt)) < 5000,
        );
        const lockedAt = new Date();
        const lockRow = await this.prisma.ccLock.create({
          data: {
            ownerParty: entry.partyId,
            userId: entry.userId,
            amountCc: meta.amountCc,
            termKey: meta.termKey,
            lockSeconds: meta.seconds,
            lockedAt,
            expiresAt: new Date(meta.expiresAt),
            status: 'LOCKED',
            lockedAmuletCid: match?.contractId ?? null,
          },
        });
        await this.users.recordTransaction({
          userId: entry.userId,
          amountCc: meta.amountCc,
          type: 'CC_LOCK',
          description: 'CC Locked',
          referenceId: lockRow.id,
          ledgerTxId: result?.updateId ?? match?.contractId,
          cantonUpdateId: result?.updateId,
        });
      } catch (err) {
        this.logger.error(
          `⚠️ AUDIT-TRAIL LOSS: lock_cc on-chain sukses (${result?.updateId ?? 'n/a'}) ` +
            `user=${entry.userId} amount=${meta.amountCc} — DB record gagal: ${String(err).slice(0, 160)}`,
        );
      }
      return;
    }

    // Unlock: flip status + history.
    if (entry.flow === 'unlock_cc') {
      const meta = entry.meta as { lockId: string; amountCc: number };
      try {
        const lockRow = await this.prisma.ccLock.findUnique({
          where: { id: meta.lockId },
          select: { lockedAmuletCid: true },
        });
        await this.prisma.ccLock.update({
          where: { id: meta.lockId },
          data: { status: 'UNLOCKED' },
        });
        // v30: lock campaign (holders=[validator]) ter-unlock → catat di
        // LockProposalRecord supaya eligibility/job tidak stale.
        if (lockRow?.lockedAmuletCid) {
          await this.lockProposals.onLockedAmuletUnlocked(lockRow.lockedAmuletCid);
        }
        await this.users.recordTransaction({
          userId: entry.userId,
          amountCc: meta.amountCc,
          type: 'CC_UNLOCK',
          description: 'CC Unlocked',
          referenceId: meta.lockId,
          ledgerTxId: result?.updateId,
          cantonUpdateId: result?.updateId,
        });
      } catch (err) {
        this.logger.error(
          `unlock_cc bookkeeping gagal (lockId=${meta.lockId}): ${String(err).slice(0, 160)}`,
        );
      }
      return;
    }

    // ── v30: Accept ClaimOffer — sinkron receipt + auto-RevealCode ─────────
    if (entry.flow === 'accept_claim_offer') {
      await this.claimOffers.onAcceptExecuted(entry.userId, entry.meta, result);
      return;
    }

    // ── v30: AcceptLock — verifikasi holders=[validator] dari ledger ───────
    if (entry.flow === 'accept_lock_proposal') {
      await this.lockProposals.onAcceptExecuted(entry.userId, entry.meta, result);
      return;
    }

    // ── v30: preapproval jalur proposal — provider ACCEPT di LATAR BELAKANG.
    // Transaksi user (proposal) sudah on-chain saat response ini balik; accept
    // adalah pekerjaan provider (2.5s tunggu index + query + submit ≈ 5-8s) dan
    // TIDAK boleh memblokir response — kalau gagal, job harian me-retry
    // (proposal idempoten). Tanpa ini toggle terasa ±10s (keluhan owner
    // 2026-09-03); kini browser balik begitu proposal masuk chain.
    if (entry.flow === 'preapproval_create_proposal') {
      const provider =
        this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';
      const partyId = entry.partyId;
      const userIdShort = entry.userId.slice(0, 8);
      setTimeout(() => {
        void this.ledger
          .acceptTransferPreapprovalProposal({
            providerParty: provider,
            receiverParty: partyId,
          })
          .then((accept) => {
            if (accept.ok) {
              this.logger.log(
                `preapproval ENABLED (jalur proposal, tanpa ValidatorRight) user=${userIdShort}… cid=${accept.transferPreapprovalCid?.slice(0, 14) ?? '?'}…`,
              );
            } else {
              this.logger.error(
                `⚠️ preapproval accept GAGAL (proposal tetap hidup, job harian retry) user=${userIdShort}… — ${accept.error}`,
              );
            }
          })
          .catch((err: unknown) => {
            this.logger.error(
              `⚠️ preapproval accept ERROR (job harian retry) user=${userIdShort}… — ${String(err).slice(0, 140)}`,
            );
          });
      }, 2500).unref?.();
      return;
    }

    if (entry.flow === 'send_cc' || entry.flow === 'send_token') {
    const meta = entry.meta as {
      amount: number;
      feeCc: number;
      feeParty: string;
      atomicFee?: boolean;
      transferKind?: string;
      recipientPartyId: string;
      recipientLabel: string;
      memo: string;
      // send_token: instrument spesifik (USDCx dll) — masuk TokenTransaction.
      instrumentId?: string;
      instrumentAdmin?: string;
    };
    const updateId = result?.updateId;
    const metaSaysOffer = meta.transferKind === 'offer';
    const isToken = entry.flow === 'send_token' && !!meta.instrumentId;

    // OFFER path: deteksi dari FAKTA on-chain, bukan meta build-time.
    // Builder WUP batch pernah salah lapor kind='direct' padahal penerima tanpa
    // preapproval (hasil nyata = offer), dan path legacy membuang transferKind
    // sama sekali. Tanpa CID benar: baris sender tidak bisa di-flip saat accept
    // & recordReceiverAccept tidak menemukan sender → penerima tidak dapat
    // TRANSFER_IN/notifikasi (bug 2026-09-04).
    let transferInstructionCid: string | null = null;
    try {
      await new Promise((r) => setTimeout(r, 1500)); // ACS index settle
      const receiverOffers = await this.ledger.queryPendingOffers(
        meta.recipientPartyId,
        'incoming',
      );
      // Exclude cid yang sudah tercatat (dua offer sejumlah sama tidak saling
      // salah-match). Window 3 hari — umur offer cuma 24 jam.
      const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const [takenCc, takenTok] = await Promise.all([
        this.prisma.ccTransaction.findMany({
          where: { transferInstructionCid: { not: null }, createdAt: { gte: since } },
          select: { transferInstructionCid: true },
        }),
        this.prisma.tokenTransaction.findMany({
          where: { transferInstructionCid: { not: null }, createdAt: { gte: since } },
          select: { transferInstructionCid: true },
        }),
      ]);
      const taken = new Set(
        [...takenCc, ...takenTok]
          .map((r) => r.transferInstructionCid)
          .filter((c): c is string => !!c),
      );
      const match = receiverOffers.find(
        (o) =>
          !taken.has(o.contractId) &&
          Math.abs(parseFloat(o.amount) - meta.amount) < 1e-6,
      );
      transferInstructionCid = match?.contractId ?? null;
    } catch {
      /* best-effort — tanpa CID, status tetap PENDING tapi tidak auto-flip */
    }
    // Fakta menang atas meta: offer pending ditemukan → ini OFFER apa pun kata
    // meta.transferKind. Tidak ditemukan + meta bilang offer → PENDING tanpa
    // cid (perilaku lama). Tidak ditemukan + direct → COMPLETED.
    const isOffer =
      transferInstructionCid !== null || metaSaysOffer;

    try {
      if (isToken) {
        // ── TOKEN (USDCx dll) → TokenTransaction dgn instrument benar ──
        await this.users.recordTokenTransaction({
          userId: entry.userId,
          amount: meta.amount,
          instrumentId: meta.instrumentId!,
          instrumentAdmin: meta.instrumentAdmin ?? '',
          type: 'TOKEN_TRANSFER_OUT',
          description: meta.memo,
          referenceId: meta.recipientPartyId,
          ledgerTxId: updateId,
          cantonUpdateId: updateId,
          status: isOffer ? 'PENDING' : 'COMPLETED',
          transferInstructionCid,
        });
      } else {
        // ── CC (Amulet) → CcTransaction ──
        await this.users.recordTransaction({
          userId: entry.userId,
          amountCc: meta.amount,
          type: 'TRANSFER_OUT',
          description: meta.memo,
          counterparty: meta.recipientPartyId,
          ledgerTxId: updateId,
          cantonUpdateId: updateId,
          status: isOffer ? 'PENDING' : 'COMPLETED',
          transferInstructionCid,
        });
      }
      if (isOffer) {
        this.logger.log(
          `${entry.flow} OFFER → ${isToken ? 'TOKEN_' : ''}TRANSFER_OUT PENDING user=${entry.userId.slice(0, 8)}… amount=${meta.amount}${isToken ? ` ${meta.instrumentId}` : ''} → ${meta.recipientLabel} cid=${transferInstructionCid?.slice(0, 14) ?? '?'}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `⚠️ AUDIT-TRAIL LOSS: relay send_cc SUCCEEDED on-chain (updateId=${updateId ?? 'n/a'}) ` +
          `user=${entry.userId} amount=${meta.amount} ` +
          `recipient=${meta.recipientPartyId} — DB record gagal: ${String(err).slice(0, 160)}`,
      );
    }

    // ── Fee leg ──────────────────────────────────────────────────────────
    // ATOMIC (v32): fee sudah settle DI DALAM transaksi yang di-sign user
    // (WalletUserProxy_BatchTransfer multi-leg) → cukup catat history dengan
    // updateId yang sama. Tidak ada submit terpisah.
    if (meta.atomicFee) {
      if (meta.feeCc > 0) {
        await this.users
          .recordTransaction({
            userId: entry.userId,
            amountCc: meta.feeCc,
            type: 'TRANSFER_OUT',
            description: `Platform fee (transfer to ${meta.recipientLabel})`,
            referenceId: `fee:${normalizeCantonPartyId(meta.feeParty) ?? meta.feeParty}`,
            // Atomic = SATU updateId untuk dua leg → constraint unik
            // (userId, ledgerTxId) akan bentrok dengan baris transfer utama.
            // Baris fee tampil tanpa ledgerTxId; tautan on-chain tetap utuh
            // via cantonUpdateId (indexed, non-unik).
            cantonUpdateId: updateId ?? undefined,
          })
          .catch((feeRecErr) => {
            this.logger.warn(
              `Atomic fee history record failed (fee settled on-chain): ${String(feeRecErr).slice(0, 120)}`,
            );
          });
        this.logger.log(
          `Atomic fee settled in-tx: ${meta.feeCc} CC → ${meta.feeParty.split('::')[0]} (updateId=${updateId?.slice(0, 16) ?? 'n/a'})`,
        );
      }
      return;
    }

    // LEGACY: kumpulkan via jalur CUSTODIAL (operator sign) — interactive
    // submission tidak support multi-command. Fee hanya dicatat di history
    // BILA benar-benar terkumpul (party external sering menolak submit
    // custodial: NO_SYNCHRONIZER_ON_WHICH_ALL_SUBMITTERS_CAN_SUBMIT).
    if (meta.feeCc > 0 && meta.feeParty) {
      try {
        const senderOnChain = await this.splice.resolveOnChainPartyId(
          entry.partyId,
        );
        const feePartyOnChain =
          await this.splice.resolveOnChainPartyId(meta.feeParty);
        const feeResult = await this.ledger.executeTransferFactoryTransfer({
          senderPartyId: senderOnChain,
          receiverPartyId: feePartyOnChain,
          amountCc: meta.feeCc,
          description: `Platform fee: ${meta.recipientLabel} (relay)`,
        });
        if (feeResult.ok) {
          this.logger.log(
            `Fee collected post-relay: ${meta.feeCc} CC from ${entry.partyId.split('::')[0]} → ${meta.feeParty.split('::')[0]}`,
          );
          await this.users
            .recordTransaction({
              userId: entry.userId,
              amountCc: meta.feeCc,
              type: 'TRANSFER_OUT',
              description: `Platform fee (transfer to ${meta.recipientLabel})`,
              referenceId: `fee:${normalizeCantonPartyId(meta.feeParty) ?? meta.feeParty}`,
              ledgerTxId: feeResult.updateId ?? undefined,
              cantonUpdateId: feeResult.updateId ?? undefined,
            })
            .catch((feeRecErr) => {
              this.logger.warn(
                `Fee history record failed (fee already collected): ${String(feeRecErr).slice(0, 120)}`,
              );
            });
        } else {
          this.logger.warn(
            `Fee collection post-relay failed (non-fatal): ${feeResult.error ?? 'unknown'}`,
          );
        }
      } catch (feeErr) {
        this.logger.warn(
          `Fee collection post-relay error (non-fatal): ${String(feeErr).slice(0, 120)}`,
        );
      }
    }
    } // end if send_cc
  }

  /**
   * Setelah accept_offer sukses: buat record TRANSFER_IN / TOKEN_TRANSFER_IN
   * untuk PENERIMA + push notifikasi badge. Data diambil dari row SENDER
   * yang baru saja di-settle (amount, instrument, counterparty).
   */
  private async recordReceiverAccept(
    transferInstructionCid: string,
    receiverUserId: string,
    updateId: string | undefined,
    offerDetail?: {
      amount: string;
      instrumentId: string;
      instrumentAdmin: string;
      sender: string;
    } | null,
  ): Promise<void> {
    try {
      // Cari row sender yang baru di-settle — dari situ ambil detail offer.
      const senderCc = await this.prisma.ccTransaction.findFirst({
        where: { transferInstructionCid, status: 'COMPLETED' },
        select: {
          amountMicroCc: true,
          description: true,
          referenceId: true, // party ID sender utk display counterparty
          userId: true,
        },
      });
      const senderToken = senderCc
        ? null
        : await this.prisma.tokenTransaction.findFirst({
            where: { transferInstructionCid, status: 'COMPLETED' },
            select: {
              amount: true,
              instrumentId: true,
              instrumentAdmin: true,
              description: true,
              referenceId: true,
              userId: true,
            },
          });

      if (senderCc) {
        // CC transfer — record TRANSFER_IN utk receiver.
        // FIX (owner 2026-09-03): referenceId HARUS party ID PENGIRIM (lawan
        // transaksi dari sudut pandang penerima) — BUKAN disalin dari
        // senderCc.referenceId yang berisi party ID PENERIMA. Salah salin =
        // baris terfilter isSelfReferenceWssRow ("(You)→(You)") → received
        // tidak pernah tampil di Activity/notification badge.
        const senderUser = await this.users.findById(senderCc.userId);
        const senderPartyId = senderUser?.cantonPartyId ?? null;
        await this.users.recordTransaction({
          userId: receiverUserId,
          amountCc: Math.abs(Number(senderCc.amountMicroCc)) / 1_000_000,
          type: 'TRANSFER_IN',
          description: senderCc.description ?? 'Received CC',
          referenceId: senderPartyId, // ← party pengirim, bukan penerima
          ledgerTxId: updateId,
          cantonUpdateId: updateId,
          status: 'COMPLETED',
        });
        this.logger.log(
          `accept_offer receiver TRANSFER_IN recorded: user=${receiverUserId.slice(0, 8)} amount=${Math.abs(Number(senderCc.amountMicroCc)) / 1_000_000} from=${senderPartyId?.split('::')[0] ?? '?'}`,
        );
      } else if (senderToken) {
        // Token (USDCx dll) — record TOKEN_TRANSFER_IN utk receiver.
        // FIX yang sama: referenceId = party pengirim.
        const tokenSenderUser = await this.users.findById(senderToken.userId);
        const tokenSenderPartyId = tokenSenderUser?.cantonPartyId ?? null;
        await this.users.recordTokenTransaction({
          userId: receiverUserId,
          amount: Math.abs(Number(senderToken.amount)),
          instrumentId: senderToken.instrumentId,
          instrumentAdmin: senderToken.instrumentAdmin ?? '',
          type: 'TOKEN_TRANSFER_IN',
          description: senderToken.description ?? 'Token received',
          referenceId: tokenSenderPartyId,
          ledgerTxId: updateId,
          cantonUpdateId: updateId,
          status: 'COMPLETED',
        });
        this.logger.log(
          `accept_offer receiver TOKEN_TRANSFER_IN recorded: user=${receiverUserId.slice(0, 8)} amount=${senderToken.amount} ${senderToken.instrumentId}`,
        );
      } else if (offerDetail) {
        // FALLBACK (2026-09-04): row sender tidak ditemukan (offer lama yang
        // dibuat sebelum fix cid, atau bookkeeping sender gagal) — pakai detail
        // offer yang di-capture buildOfferAction saat PREPARE. Tanpa fallback
        // ini penerima TIDAK pernah dapat TRANSFER_IN + notifikasi.
        const amount = Math.abs(parseFloat(offerDetail.amount) || 0);
        const senderPartyId = offerDetail.sender || null;
        const isTokenOffer =
          offerDetail.instrumentId &&
          offerDetail.instrumentId.toLowerCase() !== 'amulet';
        if (isTokenOffer) {
          await this.users.recordTokenTransaction({
            userId: receiverUserId,
            amount,
            instrumentId: offerDetail.instrumentId,
            instrumentAdmin: offerDetail.instrumentAdmin ?? '',
            type: 'TOKEN_TRANSFER_IN',
            description: `Received ${amount} ${offerDetail.instrumentId} (on-chain)`,
            referenceId: senderPartyId,
            ledgerTxId: updateId,
            cantonUpdateId: updateId,
            status: 'COMPLETED',
          });
        } else {
          await this.users.recordTransaction({
            userId: receiverUserId,
            amountCc: amount,
            type: 'TRANSFER_IN',
            description: `Received ${amount} CC (on-chain)`,
            counterparty: senderPartyId ?? undefined,
            ledgerTxId: updateId,
            cantonUpdateId: updateId,
            status: 'COMPLETED',
          });
        }
        this.logger.log(
          `accept_offer receiver row recorded (offer-detail fallback): user=${receiverUserId.slice(0, 8)} amount=${amount} ${offerDetail.instrumentId}`,
        );
      } else {
        this.logger.warn(
          `accept_offer receiver row TIDAK tercatat: cid=${transferInstructionCid.slice(0, 16)}… tidak ketemu di row sender & tanpa offer-detail meta`,
        );
      }
    } catch (err) {
      // Non-fatal: accept sudah sukses on-chain — hanya notifikasi yang gagal.
      this.logger.warn(
        `recordReceiverAccept gagal (non-fatal): ${String(err).slice(0, 160)}`,
      );
    }
  }

  /**
   * Flow: wallet_registration_accept.
   * Idempoten — kalau WalletRegistration/proposal aktif sudah ada untuk user,
   * tetap kirim Accept untuk proposal pending; kalau tak ada keduanya, buat
   * proposal baru (leg operator, custodial — sah karena signatory admin).
   */
  private async buildWalletRegistrationAccept(user: {
    partyId: string;
    username: string | null;
  }): Promise<BuiltFlow> {
    const tpl = `${this.packagePrefix}:Main:WalletRegistrationProposal`;
    const operator =
      this.config.get<string>('CANTON_OPERATOR_PARTY_ID') ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ||
      '';

    // Cari proposal pending untuk user ini (idempotency ala quest-ledger).
    const acs = await this.ledger
      .queryActiveContracts(tpl, [operator])
      .catch(() => []);
    const cidExisting = this.findContractId(
      Array.isArray(acs) ? acs : [],
      (args) => args.userAddress === user.partyId,
    );
    let cid = cidExisting;

    if (!cid) {
      const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      const res = await this.ledger.createContract(
        tpl,
        {
          admin: operator,
          userAddress: user.partyId,
          userProfileRef: `user:${user.partyId.split('::')[0]}`,
          partyId: user.partyId,
          registeredAt: nowIso,
        },
        [operator],
        `relay-prop-${randomUUID()}`,
      );
      if (!res.ok || !res.contractId) {
        throw new BadRequestException(
          'Failed to create the registration proposal on the ledger.',
        );
      }
      cid = res.contractId;
    }

    return {
      commands: [
        {
          ExerciseCommand: {
            templateId: tpl,
            contractId: cid,
            choice: 'Accept',
            choiceArgument: {},
          },
        },
      ],
      description: 'Activate wallet registration on the CanQuest ledger',
    };
  }

  /**
   * Resolusi penerima bersama utk send_cc/send_token — mirror controller:
   * input username (@user) atau Canton party id; tolak self & wallet sistem;
   * return partyId casing asli utk submit + label UI.
   */
  private async resolveSendRecipient(
    user: { partyId: string; username: string | null },
    to: string,
  ): Promise<{ recipientPartyId: string; recipientLabel: string }> {
    let recipientPartyId: string;
    let recipientLabel: string;
    if (looksLikeCantonPartyId(to)) {
      const normalized = normalizeCantonPartyId(to);
      if (!normalized) throw new BadRequestException('Invalid Party ID format.');
      if (cantonPartyIdsEqual(normalized, user.partyId)) {
        throw new BadRequestException('You cannot send to yourself.');
      }
      if (this.isSystemPartyId(normalized)) {
        throw new BadRequestException(
          'Transfers to platform wallets are not allowed.',
        );
      }
      recipientPartyId = to; // casing asli (Canton case-sensitive)
      recipientLabel = normalized.split('::')[0] ?? normalized;
    } else {
      const username = to.replace(/^@/, '').toLowerCase();
      if (username === user.username?.toLowerCase()) {
        throw new BadRequestException('You cannot send to yourself.');
      }
      const dbUser = await this.users.findByUsernameInsensitive(username);
      const resolved =
        dbUser?.cantonPartyId ?? (await this.splice.getUserPartyId(username));
      if (!resolved) {
        throw new BadRequestException(
          `User "@${username}" not found or has no wallet.`,
        );
      }
      recipientPartyId = normalizeCantonPartyId(resolved) ?? resolved;
      if (this.isSystemPartyId(recipientPartyId)) {
        throw new BadRequestException(
          'Transfers to platform wallets are not allowed.',
        );
      }
      recipientLabel = `@${username}`;
    }
    return { recipientPartyId, recipientLabel };
  }

  /**
   * Flow: send_cc — kirim CC oleh user external.
   *
   * SATU tanda tangan untuk transfer + platform fee (dua exercise dalam satu
   * prepared transaction → all-or-nothing, semangat atomic path custodial).
   * Jalur: TransferFactory CIP-0056 (otorisasi tunggal pengirim — cocok untuk
   * interactive submission). Kind offer/direct mengikuti preapproval receiver,
   * sama seperti jalur lama.
   *
   * Validasi mereplikasi party-transfer.controller sendCc: resolusi penerima
   * (username / party id), larangan kirim ke diri sendiri & wallet sistem,
   * cek saldo cache.
   */
  private async buildSendCc(
    user: { userId: string; partyId: string; username: string | null },
    params: Record<string, unknown>,
  ): Promise<BuiltFlow> {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0.');
    }
    const feeCc = Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? 0);
    const to = typeof params.to === 'string' ? params.to.trim() : '';
    if (!to) throw new BadRequestException('Recipient is required.');
    const memo = typeof params.memo === 'string' ? params.memo.trim() : '';
    const clientNonce =
      typeof params.clientNonce === 'string' ? params.clientNonce : undefined;

    // ── Resolusi penerima (helper bersama dgn send_token) ────────────────
    const { recipientPartyId, recipientLabel } =
      await this.resolveSendRecipient(user, to);

    // ── Balance check (cache DB — mirror controller) ─────────────────────
    const dbBalance = await this.prisma.ccBalance
      .findUnique({
        where: { userId: user.userId },
        select: { balanceMicroCc: true },
      })
      .catch(() => null);
    if (dbBalance) {
      const cachedCc = Number(dbBalance.balanceMicroCc) / 1_000_000;
      if (cachedCc < amount + feeCc) {
        throw new BadRequestException(
          feeCc > 0
            ? `Insufficient balance. Need ${amount + feeCc} CC (${amount} transfer + ${feeCc} platform fee).`
            : `Insufficient balance. Need ${amount} CC.`,
        );
      }
    }

    // ── Resolve casing on-chain kedua party ──────────────────────────────
    const [senderOnChain, receiverOnChain] = await Promise.all([
      this.splice.resolveOnChainPartyId(user.partyId),
      this.splice.resolveOnChainPartyId(recipientPartyId),
    ]);

    // ── LEGACY single-transfer (fallback terakhir + jalur non-atomic) ────
    const feePartyRaw =
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    const buildLegacySingle = async (): Promise<BuiltFlow> => {
      const main = await this.ledger.buildCip56TransferCommand({
        senderPartyId: senderOnChain,
        receiverPartyId: receiverOnChain,
        amountCc: amount,
        description: memo || undefined,
        clientNonce,
      });
      if (!main.ok) {
        throw new BadRequestException(main.error);
      }
      // Fee leg dikumpulkan via jalur custodial (operator sign) di postExecute
      // — legacy hanya utk kasus atomic gagal total.
      return {
        commands: [main.command],
        disclosedContracts: main.disclosedContracts,
        commandId: clientNonce
          ? main.commandId.replace(/^tf-/, '')
          : undefined,
        meta: {
          amount,
          feeCc,
          feeParty: feePartyRaw ?? '',
          transferKind: main.transferKind,
          recipientPartyId,
          recipientLabel,
          memo,
        },
        description: `Send ${amount} CC to ${recipientLabel}`,
      };
    };

    // ── ATOMIC (v33 — alur canton-loop): transfer + platform fee dalam SATU
    // submission, SATU ExerciseCommand TransferFactory_Transfer per leg.
    // Dua exercise terpisah tiap leg bebas owner-group constraint WUP → leg
    // ke party EXTERNAL (CEX / user validator lain) pun atomic. Rantai
    // fallback bila participant menolak multi-command: WUP BatchTransfer
    // (terbukti utk receiver internal) → legacy single + fee custodial.
    if (
      this.config.get<string>('QUEST_ATOMIC_PLATFORM_TRANSFER') === 'true' &&
      feeCc > 0
    ) {
      try {
        const feePartyRawAtomic =
          this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
          this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
        if (feePartyRawAtomic) {
          const feePartyOnChain =
            await this.splice.resolveOnChainPartyId(feePartyRawAtomic);
          const dsoAtomic =
            this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '';
          const legs = () => [
            {
              receiverPartyId: receiverOnChain,
              amount,
              instrumentId: 'Amulet',
              instrumentAdmin: dsoAtomic,
              description: memo || `Send to ${recipientLabel}`,
            },
            {
              receiverPartyId: feePartyOnChain,
              amount: feeCc,
              instrumentId: 'Amulet',
              instrumentAdmin: dsoAtomic,
              description: `Platform fee: ${recipientLabel}`,
            },
          ];

          // Attempt 1 — multi-command canton-loop (2× TransferFactory_Transfer).
          let multi: FactoryMultiBuild | null = null;
          if (!this.multiCommandRejected) {
            try {
              const m = await this.ledger.buildFactoryTransferCommands({
                senderPartyId: senderOnChain,
                transfers: legs(),
                clientNonce,
              });
              if (m.ok) {
                multi = m;
              } else {
                this.logger.warn(
                  `send_cc multi-command build failed: ${m.error}`,
                );
              }
            } catch (err) {
              this.logger.warn(
                `send_cc multi-command build error: ${String(err).slice(0, 140)}`,
              );
            }
          }

          // Attempt 2 — WUP BatchTransfer (proven receiver internal; utk
          // receiver external akan gagal saat prepare → turun ke legacy).
          let wupBuilt: BuiltFlow | undefined;
          const batch = await this.ledger.buildProxyBatchTransferCommand({
            senderPartyId: senderOnChain,
            transfers: legs(),
            clientNonce,
          });
          if (batch.ok) {
            wupBuilt = {
              commands: [batch.command],
              disclosedContracts: batch.disclosedContracts,
              commandId: clientNonce ? batch.commandId : undefined,
              meta: {
                amount,
                feeCc,
                feeParty: feePartyRawAtomic,
                atomicFee: true,
                transferKind: batch.transferKind,
                recipientPartyId,
                recipientLabel,
                memo,
              },
              description: `Send ${amount} CC to ${recipientLabel}`,
            };
          } else {
            this.logger.warn(
              `send_cc atomic WUP build failed: ${batch.error}`,
            );
          }

          if (multi) {
            // Rantai fallback: WUP → legacy (dibangun eager — biaya 1 registry
            // call, hanya jadi jaminan bila multi prepare ditolak participant).
            let fallbackChain: BuiltFlow | undefined = wupBuilt;
            try {
              const legacy = await buildLegacySingle();
              if (fallbackChain) fallbackChain.fallback = legacy;
              else fallbackChain = legacy;
            } catch {
              /* legacy gagal build → rantai sependek yang tersedia */
            }
            this.logger.log(
              `send_cc ATOMIC multi-command ready (canton-loop): ${amount} CC → ${recipientLabel} + fee ${feeCc} CC (kind=${multi.transferKind})`,
            );
            return {
              commands: multi.commands,
              disclosedContracts: multi.disclosedContracts,
              commandId: clientNonce ? multi.commandId : undefined,
              meta: {
                amount,
                feeCc,
                feeParty: feePartyRawAtomic,
                atomicFee: true,
                transferKind: multi.transferKind,
                recipientPartyId,
                recipientLabel,
                memo,
              },
              description: `Send ${amount} CC to ${recipientLabel}`,
              fallback: fallbackChain,
            };
          }

          if (wupBuilt) {
            this.logger.log(
              `send_cc ATOMIC batch ready (WUP): ${amount} CC → ${recipientLabel} + fee ${feeCc} CC (kind=${String(wupBuilt.meta?.transferKind ?? '?')})`,
            );
            return wupBuilt;
          }
        }
      } catch (err) {
        this.logger.warn(
          `send_cc atomic build error → legacy single: ${String(err).slice(0, 140)}`,
        );
      }
    }

    return buildLegacySingle();
  }

  /**
   * Operator party platform Utilities (DA) — dipakai field `operator`
   * TransferPreapproval registry (kontrak: signatory receiver, OBSERVER =
   * operator ini). Sumber: GET {UTILITY_REGISTRY_BASE_URL}/api/utilities/v0/
   * operator (pola resmi docs "Transfer Preapproval API Example" — operator
   * TIDAK boleh diisi registrar/receiver). Cache 1 jam per proses.
   * Terbukti MainNet 2026-08-29: operator salah (registrar) → registry
   * mengabaikan preapproval → transfer tetap offer.
   */
  private utilitiesOperatorCache: { party: string; exp: number } | null = null;
  private async getUtilitiesOperator(): Promise<string | null> {
    const cached = this.utilitiesOperatorCache;
    if (cached && Date.now() < cached.exp) return cached.party;
    const base = (
      this.config.get<string>('UTILITY_REGISTRY_BASE_URL') ??
      'https://api.utilities.digitalasset.com'
    ).replace(/\/$/, '');
    try {
      const res = await fetch(`${base}/api/utilities/v0/operator`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const j = (await res.json()) as { partyId?: string };
        if (j.partyId) {
          this.utilitiesOperatorCache = {
            party: j.partyId,
            exp: Date.now() + 60 * 60 * 1000,
          };
          return j.partyId;
        }
      }
      this.logger.warn(
        `Utilities operator endpoint tidak balas partyId (status ${res.status})`,
      );
    } catch (err) {
      this.logger.warn(
        `Utilities operator fetch gagal: ${String(err).slice(0, 120)}`,
      );
    }
    return null;
  }

  /**
   * Flow: usdcx_preapproval_enable — buat TransferPreapproval TOKEN REGISTRY
   * (USDCx) agar transfer masuk one-step tanpa Accept (CIP-0056 generic).
   *
   * Template Utility.Registry.App.V0.Model.TransferPreapproval — signatory =
   * RECEIVER → CreateCommand cukup SATU signature user (interactive prepare,
   * tanpa disclosed contracts). instrumentAllowances kosong = SEMUA instrument
   * milik instrumentAdmin (registrar USDCx). `operator` = operator party
   * platform Utilities (getUtilitiesOperator) — WAJIB benar agar registry
   * memakai preapproval saat matching transfer direct.
   */
  private async buildRegistryPreapprovalEnable(user: {
    userId: string;
    partyId: string;
    username: string | null;
  }): Promise<BuiltFlow> {
    const senderOnChain = await this.splice.resolveOnChainPartyId(user.partyId);
    const existing = await this.ledger.findRegistryPreapproval(senderOnChain);
    if (existing) {
      throw new BadRequestException(
        'USDCx instant receive is already active.',
      );
    }
    const instrumentAdmin =
      this.config.get<string>('CANTON_USDCX_INSTRUMENT_ADMIN')?.trim() ||
      // Registrar USDCx MainNet (source instrumentAdmin holding USDCx).
      'decentralized-usdc-interchain-rep::12208115f1e168dd7e792320be9c4ca720c751a02a3053c7606e1c1cd3dad9bf60ef';
    const operator =
      this.config.get<string>('CANTON_USDCX_PREAPPROVAL_OPERATOR')?.trim() ||
      (await this.getUtilitiesOperator()) ||
      instrumentAdmin; // last-resort fallback ( Salah — registry takkan match.)
    const pkgId =
      this.config.get<string>('CANTON_USDCX_PREAPPROVAL_PACKAGE_ID')?.trim() ||
      // utility-registry-app-v0 MainNet (verified /v2/packages — satu-satunya
      // paket dengan marker InstrumentAllowance).
      '7a75ef6e69f69395a4e60919e228528bb8f3881150ccfde3f31bcc73864b18ab';

    this.logger.log(
      `usdcx_preapproval_enable: receiver=${senderOnChain.split('::')[0]} ` +
        `admin=${instrumentAdmin.split('::')[0]} operator=${operator.split('::')[0]}`,
    );
    return {
      commands: [
        {
          CreateCommand: {
            templateId: `${pkgId}:Utility.Registry.App.V0.Model.TransferPreapproval:TransferPreapproval`,
            createArguments: {
              operator,
              receiver: senderOnChain,
              instrumentAdmin,
              instrumentAllowances: [],
            },
          },
        },
      ],
      meta: { instrumentAdmin },
      description: 'Enable USDCx instant receive',
    };
  }

  /**
   * Flow: usdcx_preapproval_disable — Archive TransferPreapproval registry
   * user (choice Archive, controller receiver → 1 signature user).
   */
  private async buildRegistryPreapprovalDisable(user: {
    userId: string;
    partyId: string;
    username: string | null;
  }): Promise<BuiltFlow> {
    const senderOnChain = await this.splice.resolveOnChainPartyId(user.partyId);
    const existing = await this.ledger.findRegistryPreapproval(senderOnChain);
    if (!existing) {
      throw new BadRequestException('USDCx instant receive is already off.');
    }
    this.logger.log(
      `usdcx_preapproval_disable: cid=${existing.contractId.slice(0, 16)}…`,
    );
    return {
      commands: [
        {
          ExerciseCommand: {
            templateId: existing.templateId,
            contractId: existing.contractId,
            choice: 'Archive',
            choiceArgument: {},
          },
        },
      ],
      meta: {},
      description: 'Disable USDCx instant receive',
    };
  }

  /**
   * Flow: accept_offer / reject_offer / withdraw_offer — aksi atas
   * TransferInstruction CIP-0056 (inbox penerima: accept/reject; sent: withdraw).
   * Otorisasi tunggal (controller = receiver utk accept/reject, sender utk
   * withdraw) → cocok interactive submission. Konstruksi mirror
   * acceptTransferInstruction/rejectTransferInstruction (choice context via
   * registry + disclosed contracts).
   */
  private async buildOfferAction(
    user: { userId: string; partyId: string; username: string | null },
    params: Record<string, unknown>,
    action: 'accept' | 'reject' | 'withdraw',
  ): Promise<BuiltFlow> {
    const cid =
      typeof params.contractId === 'string' ? params.contractId.trim() : '';
    if (!cid) throw new BadRequestException('contractId is required.');

    // Detail offer (instrumentAdmin utk choice context) — best-effort.
    // SEKALIGUS di-capture ke meta: recordReceiverAccept pakai ini sebagai
    // fallback kalau row sender tidak ketemu (offer dibuat sebelum fix cid /
    // bookkeeping sender gagal) supaya penerima tetap dapat TRANSFER_IN +
    // notifikasi. Both directions: withdraw = outgoing (user = sender).
    let instrumentAdmin = '';
    let offerSnapshot: {
      amount: string;
      instrumentId: string;
      instrumentAdmin: string;
      sender: string;
    } | null = null;
    try {
      const detail = await this.ledger.lookupOfferDetailBothDirections(
        cid,
        user.partyId,
      );
      if (detail) {
        if (detail.instrumentAdmin) instrumentAdmin = detail.instrumentAdmin;
        offerSnapshot = {
          amount: detail.amount,
          instrumentId: detail.instrumentId || 'Amulet',
          instrumentAdmin: detail.instrumentAdmin || '',
          sender: detail.sender || '',
        };
      }
    } catch {
      /* default CC (admin kosong) */
    }

    const choiceCtx = await this.ledger.getInstructionChoiceContext(
      cid,
      action,
      instrumentAdmin,
    );
    if (!choiceCtx) {
      throw new BadRequestException(
        'Failed to fetch choice context from registry — coba lagi sebentar.',
      );
    }

    const choiceName =
      action === 'accept'
        ? 'TransferInstruction_Accept'
        : action === 'reject'
          ? 'TransferInstruction_Reject'
          : 'TransferInstruction_Withdraw';

    const labels = {
      accept: 'Accept incoming transfer',
      reject: 'Reject incoming transfer',
      withdraw: 'Withdraw sent transfer',
    } as const;

    return {
      commands: [
        {
          ExerciseCommand: {
            templateId:
              '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
            contractId: cid,
            choice: choiceName,
            choiceArgument: {
              extraArgs: {
                context: choiceCtx.choiceContextData,
                meta: { values: {} },
              },
            },
          },
        },
      ],
      disclosedContracts: choiceCtx.disclosedContracts,
      meta: { cid, action, offer: offerSnapshot },
      description: labels[action],
    };
  }

  /**
   * Flow: send_token — kirim token non-CC (USDCx, CBTC, …) oleh user external.
   * Satu tanda tangan untuk: transfer token (registry non-CC) + platform fee
   * dalam CC (mirror pola send_cc; fee CC dibayar sender seperti jalur lama).
   */
  private async buildSendToken(
    user: { userId: string; partyId: string; username: string | null },
    params: Record<string, unknown>,
  ): Promise<BuiltFlow> {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0.');
    }
    const instrumentId =
      typeof params.instrumentId === 'string' ? params.instrumentId.trim() : '';
    const instrumentAdmin =
      typeof params.instrumentAdmin === 'string'
        ? params.instrumentAdmin.trim()
        : '';
    if (!instrumentId || instrumentId.toLowerCase() === 'amulet') {
      throw new BadRequestException('Use send_cc for Canton Coin (CC).');
    }
    if (!instrumentAdmin) {
      throw new BadRequestException(
        'instrumentId and instrumentAdmin are required for token transfers.',
      );
    }
    const feeCc = Number(this.config.get<string>('TRANSACTION_FEE_CC') ?? 0);
    const to = typeof params.to === 'string' ? params.to.trim() : '';
    if (!to) throw new BadRequestException('Recipient is required.');
    const memo = typeof params.memo === 'string' ? params.memo.trim() : '';
    const clientNonce =
      typeof params.clientNonce === 'string' ? params.clientNonce : undefined;

    const { recipientPartyId, recipientLabel } =
      await this.resolveSendRecipient(user, to);

    // Fee pre-check: fee dalam CC → sender butuh saldo CC (mirror controller).
    const dbBalance = await this.prisma.ccBalance
      .findUnique({
        where: { userId: user.userId },
        select: { balanceMicroCc: true },
      })
      .catch(() => null);
    if (dbBalance && feeCc > 0) {
      const cachedCc = Number(dbBalance.balanceMicroCc) / 1_000_000;
      if (cachedCc < feeCc) {
        throw new BadRequestException(
          `Insufficient CC for fee. Need ${feeCc} CC (platform fee for token transfer).`,
        );
      }
    }

    const [senderOnChain, receiverOnChain] = await Promise.all([
      this.splice.resolveOnChainPartyId(user.partyId),
      this.splice.resolveOnChainPartyId(recipientPartyId),
    ]);

    // ── LEGACY single-transfer (fallback terakhir + jalur non-atomic) ────
    const feePartyRaw =
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    const buildLegacySingle = async (): Promise<BuiltFlow> => {
      const main = await this.ledger.buildCip56TransferCommand({
        senderPartyId: senderOnChain,
        receiverPartyId: receiverOnChain,
        amountCc: amount,
        description: memo || undefined,
        clientNonce,
        instrumentId,
        instrumentAdmin,
      });
      if (!main.ok) throw new BadRequestException(main.error);
      // Fee leg dikumpulkan via jalur custodial di postExecute (sama seperti
      // send_cc) — legacy hanya utk kasus atomic gagal total.
      return {
        commands: [main.command],
        disclosedContracts: main.disclosedContracts,
        commandId: clientNonce
          ? main.commandId.replace(/^tf-/, '')
          : undefined,
        meta: {
          amount,
          feeCc,
          feeParty: feePartyRaw ?? '',
          transferKind: main.transferKind,
          recipientPartyId,
          recipientLabel,
          memo,
          instrumentId,
          instrumentAdmin,
        },
        description: `Send ${amount} ${instrumentId} to ${recipientLabel}`,
      };
    };

    // ── ATOMIC (v33 — alur canton-loop): token leg + fee CC, SATU
    // ExerciseCommand TransferFactory_Transfer per leg dalam satu submission
    // (factory beda instrument, holdings beda pool — tidak ada overlap).
    // Rantai fallback: WUP BatchTransfer → legacy single + fee custodial.
    if (
      this.config.get<string>('QUEST_ATOMIC_PLATFORM_TRANSFER') === 'true' &&
      feeCc > 0
    ) {
      try {
        const feePartyRawAtomic =
          this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
          this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
        if (feePartyRawAtomic) {
          const feePartyOnChain =
            await this.splice.resolveOnChainPartyId(feePartyRawAtomic);
          const dsoAtomic =
            this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '';
          const legs = () => [
            {
              receiverPartyId: receiverOnChain,
              amount,
              instrumentId,
              instrumentAdmin,
              description: memo || `Send to ${recipientLabel}`,
            },
            {
              receiverPartyId: feePartyOnChain,
              amount: feeCc,
              instrumentId: 'Amulet',
              instrumentAdmin: dsoAtomic,
              description: `Platform fee: ${recipientLabel}`,
            },
          ];

          // Attempt 1 — multi-command canton-loop.
          let multi: FactoryMultiBuild | null = null;
          if (!this.multiCommandRejected) {
            try {
              const m = await this.ledger.buildFactoryTransferCommands({
                senderPartyId: senderOnChain,
                transfers: legs(),
                clientNonce,
              });
              if (m.ok) {
                multi = m;
              } else {
                this.logger.warn(
                  `send_token multi-command build failed: ${m.error}`,
                );
              }
            } catch (err) {
              this.logger.warn(
                `send_token multi-command build error: ${String(err).slice(0, 140)}`,
              );
            }
          }

          // Attempt 2 — WUP BatchTransfer (proven receiver internal).
          let wupBuilt: BuiltFlow | undefined;
          const batch = await this.ledger.buildProxyBatchTransferCommand({
            senderPartyId: senderOnChain,
            transfers: legs(),
            clientNonce,
          });
          if (batch.ok) {
            wupBuilt = {
              commands: [batch.command],
              disclosedContracts: batch.disclosedContracts,
              commandId: clientNonce ? batch.commandId : undefined,
              meta: {
                amount,
                feeCc,
                feeParty: feePartyRawAtomic,
                atomicFee: true,
                transferKind: batch.transferKind,
                recipientPartyId,
                recipientLabel,
                memo,
                instrumentId,
              },
              description: `Send ${amount} ${instrumentId} to ${recipientLabel}`,
            };
          } else {
            this.logger.warn(
              `send_token atomic WUP build failed: ${batch.error}`,
            );
          }

          if (multi) {
            let fallbackChain: BuiltFlow | undefined = wupBuilt;
            try {
              const legacy = await buildLegacySingle();
              if (fallbackChain) fallbackChain.fallback = legacy;
              else fallbackChain = legacy;
            } catch {
              /* legacy gagal build → rantai sependek yang tersedia */
            }
            this.logger.log(
              `send_token ATOMIC multi-command ready (canton-loop): ${amount} ${instrumentId} → ${recipientLabel} + fee ${feeCc} CC (kind=${multi.transferKind})`,
            );
            return {
              commands: multi.commands,
              disclosedContracts: multi.disclosedContracts,
              commandId: clientNonce ? multi.commandId : undefined,
              meta: {
                amount,
                feeCc,
                feeParty: feePartyRawAtomic,
                atomicFee: true,
                transferKind: multi.transferKind,
                recipientPartyId,
                recipientLabel,
                memo,
                instrumentId,
              },
              description: `Send ${amount} ${instrumentId} to ${recipientLabel}`,
              fallback: fallbackChain,
            };
          }

          if (wupBuilt) {
            this.logger.log(
              `send_token ATOMIC batch ready (WUP): ${amount} ${instrumentId} → ${recipientLabel} + fee ${feeCc} CC (kind=${String(wupBuilt.meta?.transferKind ?? '?')})`,
            );
            return wupBuilt;
          }
        }
      } catch (err) {
        this.logger.warn(
          `send_token atomic build error → legacy single: ${String(err).slice(0, 140)}`,
        );
      }
    }

    return buildLegacySingle();
  }

  /**
   * Parse LOCK_TERM_OPTIONS ("2m:120,5m:300,10m:600") — mirror getLockTerms
   * di party-lock.controller.
   */
  private lockTerms(): Map<string, number> {
    const map = new Map<string, number>();
    const raw = this.config.get<string>('LOCK_TERM_OPTIONS') ?? '';
    for (const pair of raw.split(',')) {
      const [key, secs] = pair.split(':').map((s) => s?.trim());
      const s = Number(secs);
      if (key && Number.isFinite(s) && s > 0) map.set(key, s);
    }
    return map;
  }

  /**
   * Flow: lock_cc — kunci CC oleh user external (AmuletRules_Transfer self-lock).
   * LockHolder = party USER (self-held) → seluruh otorisasi tunggal di tangan
   * user, cocok interactive submission. Fungsional setara untuk eligibility
   * quest (LockedAmulet dibaca per owner, holder tidak relevan).
   */
  private async buildLockCc(
    user: { userId: string; partyId: string; username: string | null },
    params: Record<string, unknown>,
  ): Promise<BuiltFlow> {
    const termKey = typeof params.termKey === 'string' ? params.termKey : '';
    const seconds = this.lockTerms().get(termKey);
    if (seconds === undefined) {
      throw new BadRequestException(`term "${termKey}" is invalid`);
    }
    const amountCc = Number(params.amountCc);
    if (!Number.isFinite(amountCc) || amountCc <= 0) {
      throw new BadRequestException('amountCc must be greater than 0.');
    }

    const ownerOnChain = await this.splice.resolveOnChainPartyId(user.partyId);
    const built = await this.ledger.buildLockCcCommand(
      ownerOnChain,
      amountCc,
      seconds,
      { lockHolderOverride: ownerOnChain }, // self-held → single-party authz
    );
    if (!built.ok) throw new BadRequestException(built.error);

    return {
      commands: [built.command],
      disclosedContracts: built.disclosedContracts,
      commandId: built.commandId,
      meta: { amountCc, termKey, seconds, expiresAt: built.expiresAt },
      description: `Lock ${amountCc} CC (${termKey})`,
    };
  }

  /**
   * Flow: unlock_cc — buka LockedAmulet milik user external
   * (LockedAmulet_OwnerExpireLockV2, actAs owner tunggal).
   */
  private async buildUnlockCc(
    user: { userId: string; partyId: string; username: string | null },
    params: Record<string, unknown>,
  ): Promise<BuiltFlow> {
    const lockId = typeof params.lockId === 'string' ? params.lockId.trim() : '';
    if (!lockId) throw new BadRequestException('lockId is required.');

    const lock = await this.prisma.ccLock.findFirst({
      where: { id: lockId, ownerParty: user.partyId, status: 'LOCKED' },
    });
    if (!lock) {
      throw new BadRequestException('Lock not found or no longer active.');
    }
    if (!lock.lockedAmuletCid) {
      throw new BadRequestException(
        'This lock has no lockedAmuletCid yet (backfill pending) — try again shortly.',
      );
    }

    const ownerOnChain = await this.splice.resolveOnChainPartyId(user.partyId);
    const built = await this.ledger.buildUnlockCcCommand(
      ownerOnChain,
      lock.lockedAmuletCid,
    );
    if (!built.ok) throw new BadRequestException(built.error);

    return {
      commands: [built.command],
      disclosedContracts: built.disclosedContracts,
      commandId: built.commandId,
      meta: { lockId: lock.id, amountCc: lock.amountCc },
      description: `Unlock ${lock.amountCc} CC`,
    };
  }

  // ═══ M5b: PREAPPROVAL via ExternalPartySetupProposal ═══════════════════

  /**
   * Prepare preapproval — JALUR PROPOSAL (bypass limit-200, keputusan owner
   * 2026-09-04): user membuat TransferPreapprovalProposal via signing relay
   * (hash standar base64 — SAMA seperti flow relay lain, browser memakai
   * signRelayPrepared). TIDAK ada lagi panggilan validator setup-proposal →
   * tidak lahir ValidatorRight baru. Accept dilakukan backend di bookkeeping
   * execute (flow 'preapproval_create_proposal').
   */
  async preparePreapproval(
    userId: string,
    _publicKeyHex: string,
  ): Promise<{
    flow: string;
    hash: string | null;
    commandId: string;
    description: string;
    alreadyEnabled?: boolean;
  }> {
    this.sweepExpired();
    // Auto-clear stale pending — preapproval prepare selalu boleh mulai fresh.
    if (this.pending.has(userId)) {
      const existing = this.pending.get(userId);
      this.logger.warn(
        `Clearing stale pending (flow=${existing?.flow}, age=${Date.now() - (existing?.createdAt ?? 0)}ms) for preapproval`,
      );
      this.pending.delete(userId);
    }

    const user = await this.requireExternalUser(userId);
    const provider =
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';
    const dso = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() ?? '';
    if (!provider) throw new BadRequestException('CANTON_VALIDATOR_PARTY_ID not set');
    if (!dso) throw new BadRequestException('CANTON_DSO_PARTY_ID not set');

    // Idempoten: preapproval sudah aktif → tidak ada yang perlu di-sign.
    try {
      const pa = await this.ledger.getTransferPreapprovalAuthoritative(user.partyId);
      if (pa.active) {
        this.logger.log(
          `prepare preapproval: already enabled on-chain, user=${userId.slice(0, 8)}…`,
        );
        return {
          flow: 'preapproval_enable',
          hash: null,
          commandId: '',
          description: 'Instant receive already active',
          alreadyEnabled: true,
        };
      }
    } catch {
      /* status unknown → lanjut; ledger yang memutuskan saat execute */
    }

    // CreateCommand proposal — bentuk PERSIS output
    // sdk.amulet.preapproval.command.create() (template #splice-wallet,
    // createArguments {provider, receiver, expectedDso}).
    const command = {
      CreateCommand: {
        templateId:
          '#splice-wallet:Splice.Wallet.TransferPreapproval:TransferPreapprovalProposal',
        createArguments: {
          provider,
          receiver: user.partyId,
          expectedDso: dso,
        },
      },
    };

    return this.prepareWithCommands(userId, 'preapproval_create_proposal', [command], {
      commandId: `v30-pa-propose-${createHash('sha256').update(user.partyId + Date.now()).digest('hex').slice(0, 24)}`,
      description: 'Enable instant receive (90 days)',
      partyId: user.partyId,
    });
  }

  /**
   * Execute preapproval — legacy jalur validator setup-proposal (TIDAK dipakai
   * lagi; toggle kini memakai /party/sign/execute standar + bookkeeping accept
   * di bawah). Dipertahankan hanya sebagai error jelas kalau ada client lama.
   */
  async executePreapproval(
    _userId: string,
    _signatureHex: string,
  ): Promise<{ transferPreapprovalCid: string; updateId?: string }> {
    throw new BadRequestException(
      'Preapproval kini memakai jalur proposal — sign via /party/sign/execute (standar relay).',
    );
  }

  /** Get Keycloak token for validator API calls. */
  /**
   * M5b: Disable preapproval via validator API DELETE.
   * Operator (provider) has the right to cancel — no user signature needed.
   */
  async disablePreapproval(userId: string): Promise<{ ok: boolean }> {
    const user = await this.requireExternalUser(userId);
    const provider =
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ?? '';
    if (!provider) throw new BadRequestException('CANTON_VALIDATOR_PARTY_ID not set');

    // Jalur LEDGER (pengganti validator-API DELETE — bebas ValidatorRight):
    // operator (provider) berhak cancel TransferPreapproval.
    const res = await this.ledger.cancelTransferPreapprovalViaLedger(user.partyId);
    if (res.ok || res.error?.includes('tidak ditemukan')) {
      this.logger.log(`preapproval disabled (ledger) user=${userId.slice(0, 8)}…`);
      return { ok: true };
    }
    throw new BadRequestException(`Disable failed: ${res.error ?? 'unknown'}`);
  }

  private tokenCache: { token: string; exp: number } | null = null;
  private async getValidatorToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.exp) return this.tokenCache.token;
    const keycloakUrl = this.config.get<string>('KEYCLOAK_URL');
    const realm = this.config.get<string>('KEYCLOAK_REALM');
    const res = await fetch(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${this.config.get('LEDGER_CLIENT_ID')}&client_secret=${this.config.get('LEDGER_CLIENT_SECRET')}&scope=daml_ledger_api`,
    });
    const json = await res.json();
    this.tokenCache = { token: json.access_token, exp: Date.now() + (json.expires_in - 30) * 1000 };
    return json.access_token;
  }

  private isSystemPartyId(partyId: string): boolean {    const candidates = [
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID'),
      this.config.get<string>('CANTON_APP_PROVIDER_PARTY_ID'),
      this.config.get<string>('CANTON_REWARD_PARTY_ID'),
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID'),
      this.config.get<string>('CANTON_FEE_PARTY_ID'),
      this.config.get<string>('CANTON_OPERATOR_PARTY_ID'),
    ];
    return candidates.some(
      (c) => !!c?.trim() && cantonPartyIdsEqual(c, partyId),
    );
  }

  discard(userId: string): void {
    this.pending.delete(userId);
  }

  /**
   * Deep-search contractId di entri ACS yang argumennya match — pola sama
   * dengan QuestLedgerService.findContractId (struktur ACS bervariasi antara
   * CreatedEvent / CreatedTreeEvent / flat).
   */
  private findContractId(
    contracts: unknown[],
    match: (args: Record<string, unknown>) => boolean,
  ): string | null {
    for (const entry of contracts) {
      if (!entry || typeof entry !== 'object') continue;
      const stack: unknown[] = [entry];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          stack.push(...cur);
          continue;
        }
        const obj = cur as Record<string, unknown>;
        const args =
          (obj.createArgument as Record<string, unknown> | undefined) ??
          ((obj.CreatedTreeEvent as Record<string, unknown> | undefined)
            ?.createArgument as Record<string, unknown> | undefined) ??
          ((obj.CreatedEvent as Record<string, unknown> | undefined)
            ?.createArgument as Record<string, unknown> | undefined);
        const cid =
          typeof obj.contractId === 'string'
            ? obj.contractId
            : typeof (
                  obj.CreatedTreeEvent as Record<string, unknown> | undefined
                )?.contractId === 'string'
              ? ((obj.CreatedTreeEvent as Record<string, unknown>)
                  .contractId as string)
              : null;
        if (args && cid && match(args)) return cid;
        for (const v of Object.values(obj)) stack.push(v);
      }
    }
    return null;
  }
}
