import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { CantonWalletSdkService } from './wallet-sdk.service';
import { CantonLedgerService } from './canton-ledger.service';
import { SpliceValidatorService } from './splice-validator.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { hasRealWallet } from '../common/wallet-policy';
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
}

@Injectable()
export class SigningRelayService {
  private readonly logger = new Logger(SigningRelayService.name);
  private readonly pending = new Map<string, PendingSigning>();

  constructor(
    private readonly sdkProvider: CantonWalletSdkService,
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

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
    });
  }

  /**
   * Prepare generik dengan command PRA-DIBANGUN — dipakai flow yang builder-nya
   * hidup di service lain (mis. QuestsService.prepareExternalFcfsClaimFee;
   * hindari circular dependency module). Hanya utk user external.
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

    const commandId = `relay-${flow}-${opts?.commandId ?? randomUUID()}`;
    const sdk = await this.sdkProvider.getSdk();
    const prepared = sdk.ledger.prepare({
      partyId: user.partyId,
      commands,
      commandId,
      ...(opts?.disclosedContracts?.length
        ? { disclosedContracts: opts.disclosedContracts as never }
        : {}),
    });
    const response = await prepared.preparedPromise;

    this.pending.set(userId, {
      userId,
      flow,
      partyId: user.partyId,
      commandId,
      prepared,
      meta: opts?.meta ?? {},
      createdAt: Date.now(),
    });

    this.logger.log(
      `prepare flow=${flow} user=${userId.slice(0, 8)}… hash=${response.preparedTransactionHash.slice(0, 12)}…`,
    );
    return {
      flow,
      hash: response.preparedTransactionHash,
      commandId,
      description: opts?.description ?? flow,
    };
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
          await this.recordReceiverAccept(
            meta.cid,
            entry.userId,
            result?.updateId,
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
        await this.prisma.ccLock.update({
          where: { id: meta.lockId },
          data: { status: 'UNLOCKED' },
        });
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

    if (entry.flow === 'send_cc' || entry.flow === 'send_token') {
    const meta = entry.meta as {
      amount: number;
      feeCc: number;
      feeParty: string;
      atomicFee?: boolean;
      recipientPartyId: string;
      recipientLabel: string;
      memo: string;
    };
    const updateId = result?.updateId;
    try {
      await this.users.recordTransaction({
        userId: entry.userId,
        amountCc: meta.amount,
        type: 'TRANSFER_OUT',
        description: meta.memo,
        counterparty: meta.recipientPartyId,
        ledgerTxId: updateId,
        cantonUpdateId: updateId,
      });
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
        await this.users.recordTransaction({
          userId: receiverUserId,
          amountCc: Math.abs(Number(senderCc.amountMicroCc)) / 1_000_000,
          type: 'TRANSFER_IN',
          description: senderCc.description ?? 'Received CC',
          referenceId: senderCc.referenceId,
          ledgerTxId: updateId,
          cantonUpdateId: updateId,
          status: 'COMPLETED',
        });
        this.logger.log(
          `accept_offer receiver TRANSFER_IN recorded: user=${receiverUserId.slice(0, 8)} amount=${Math.abs(Number(senderCc.amountMicroCc)) / 1_000_000}`,
        );
      } else if (senderToken) {
        // Token (USDCx dll) — record TOKEN_TRANSFER_IN utk receiver.
        await this.users.recordTokenTransaction({
          userId: receiverUserId,
          amount: Math.abs(Number(senderToken.amount)),
          instrumentId: senderToken.instrumentId,
          instrumentAdmin: senderToken.instrumentAdmin ?? '',
          type: 'TOKEN_TRANSFER_IN',
          description: senderToken.description ?? 'Token received',
          referenceId: senderToken.referenceId,
          ledgerTxId: updateId,
          cantonUpdateId: updateId,
          status: 'COMPLETED',
        });
        this.logger.log(
          `accept_offer receiver TOKEN_TRANSFER_IN recorded: user=${receiverUserId.slice(0, 8)} amount=${senderToken.amount} ${senderToken.instrumentId}`,
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

    // ── ATOMIC (v32): transfer + platform fee dalam SATU command via
    // WalletUserProxy_BatchTransfer. Controller choice = first sender →
    // cukup SATU tanda tangan user (interactive submission). Semua leg
    // settle atau batal semua — fee dijamin terkumpul bersama transfer.
    // Fallback: single-transfer legacy + fee custodial postExecute bila
    // WUP/registry tidak tersedia atau build gagal.
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
          const batch = await this.ledger.buildProxyBatchTransferCommand({
            senderPartyId: senderOnChain,
            transfers: [
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
            ],
            clientNonce,
          });
          if (batch.ok) {
            this.logger.log(
              `send_cc ATOMIC batch ready: ${amount} CC → ${recipientLabel} + fee ${feeCc} CC (kind=${batch.transferKind})`,
            );
            return {
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
          }
          this.logger.warn(
            `send_cc atomic build failed → legacy single: ${batch.error}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `send_cc atomic build error → legacy single: ${String(err).slice(0, 140)}`,
        );
      }
    }

    // ── Bangun command transfer utama (legacy single-transfer) ───────────
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

    // ── Interactive submission HANYA support 1 command per prepare ──────
    // Fee leg dikumpulkan via jalur custodial (operator sign) DI postExecute,
    // BUKAN di-include di sini — "Preparing multiple commands is currently
    // not supported" (VPS MainNet 2026-08-25).
    const commands: unknown[] = [main.command];
    const disclosed = [...main.disclosedContracts];
    const feePartyRaw =
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();

    return {
      commands,
      disclosedContracts: disclosed,
      commandId: clientNonce ? main.commandId.replace(/^tf-/, '') : undefined,
      meta: {
        amount,
        feeCc,
        feeParty: feePartyRaw ?? '',
        recipientPartyId,
        recipientLabel,
        memo,
      },
      description: `Send ${amount} CC to ${recipientLabel}`,
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
    let instrumentAdmin = '';
    try {
      const detail = await this.ledger.lookupOfferDetail(cid, user.partyId);
      if (detail?.instrumentAdmin) instrumentAdmin = detail.instrumentAdmin;
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
      meta: { cid, action },
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

    // ── ATOMIC (v32): token leg + fee CC dalam SATU command via
    // WalletUserProxy_BatchTransfer (instrument campur — registry per
    // instrument). Fallback: legacy single + fee custodial postExecute.
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
          const batch = await this.ledger.buildProxyBatchTransferCommand({
            senderPartyId: senderOnChain,
            transfers: [
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
            ],
            clientNonce,
          });
          if (batch.ok) {
            this.logger.log(
              `send_token ATOMIC batch ready: ${amount} ${instrumentId} → ${recipientLabel} + fee ${feeCc} CC (kind=${batch.transferKind})`,
            );
            return {
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
          }
          this.logger.warn(
            `send_token atomic build failed → legacy single: ${batch.error}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `send_token atomic build error → legacy single: ${String(err).slice(0, 140)}`,
        );
      }
    }

    // Leg utama: transfer token non-CC (legacy single-transfer).
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

    // Interactive submission hanya 1 command — fee leg dikumpulkan via
    // custodial di postExecute (sama seperti send_cc).
    const commands: unknown[] = [main.command];
    const disclosed = [...main.disclosedContracts];
    const feePartyRaw =
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();

    return {
      commands,
      disclosedContracts: disclosed,
      commandId: clientNonce ? main.commandId.replace(/^tf-/, '') : undefined,
      meta: {
        amount,
        feeCc,
        feeParty: feePartyRaw ?? '',
        recipientPartyId,
        recipientLabel,
        memo,
        instrumentId,
      },
      description: `Send ${amount} ${instrumentId} to ${recipientLabel}`,
    };
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
   * Prepare preapproval via validator API (bukan ledger API).
   * Hash yang di-return: RAW 32 bytes hex-encoded (TANPA 1220 prefix).
   * Browser sign raw bytes TANPA prefix — berbeda dari relay biasa!
   */
  async preparePreapproval(
    userId: string,
    publicKeyHex: string,
  ): Promise<{
    flow: string;
    hash: string | null;
    commandId: string;
    description: string;
    alreadyEnabled?: boolean;
  }> {
    this.sweepExpired();
    // Auto-clear stale pending dari auto-accept / attempt sebelumnya —
    // preapproval prepare selalu boleh mulai fresh.
    if (this.pending.has(userId)) {
      const existing = this.pending.get(userId);
      this.logger.warn(
        `Clearing stale pending (flow=${existing?.flow}, age=${Date.now() - (existing?.createdAt ?? 0)}ms) for preapproval`,
      );
      this.pending.delete(userId);
    }

    const user = await this.requireExternalUser(userId);
    const valUrl = (this.config.get<string>('CANTON_VALIDATOR_URL') ?? '').replace(/\/$/, '');
    if (!valUrl) throw new BadRequestException('CANTON_VALIDATOR_URL not set');

    // Preflight: fingerprint dari kunci browser HARUS sama dengan fingerprint di
    // party ID. Kalau beda (user re-create wallet key tanpa re-register), semua
    // signature akan ditolak validator dengan error kabur "0 valid signatures".
    const partyFp = user.partyId.split('::')[1];
    if (partyFp) {
      const computed =
        '1220' +
        createHash('sha256')
          .update(Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from(publicKeyHex, 'hex')]))
          .digest('hex');
      if (computed !== partyFp) {
        throw new BadRequestException(
          'Your wallet key does not match this wallet on-chain. ' +
            'Restore your original key via Settings → Restore from Backup Key.',
        );
      }
    }

    const token = await this.getValidatorToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Step 1: Create or reuse setup proposal
    let contractId: string | null = null;
    const propRes = await fetch(`${valUrl}/api/validator/v0/admin/external-party/setup-proposal`, {
      method: 'POST', headers, body: JSON.stringify({ user_party_id: user.partyId }),
    });
    const propText = await propRes.text();
    if (propRes.ok) {
      contractId = JSON.parse(propText).contract_id;
    } else if (propRes.status === 409) {
      // Dua makna 409 yang BERBEDA:
      //  a. "TransferPreapproval contract already exists" → preapproval SUDAH AKTIF.
      //     Tidak ada yang perlu di-sign — idempotent success (toggle harus ON).
      //  b. Proposal accept masih hidup dari attempt sebelumnya → pakai contract_id itu.
      if (/TransferPreapproval contract already exists/i.test(propText)) {
        this.logger.log(
          `prepare preapproval: already enabled on-chain, user=${userId.slice(0, 8)}…`,
        );
        return {
          flow: 'preapproval_enable', hash: null, commandId: '',
          description: 'Instant receive already active', alreadyEnabled: true,
        };
      }
      contractId = propText.match(/ContractId\(([^)]+)\)/)?.[1] ?? null;
    }
    if (!contractId) throw new BadRequestException(`Setup proposal failed: ${propText.slice(0, 150)}`);

    // Step 2: Prepare accept
    const prepRes = await fetch(`${valUrl}/api/validator/v0/admin/external-party/setup-proposal/prepare-accept`, {
      method: 'POST', headers,
      body: JSON.stringify({ user_party_id: user.partyId, contract_id: contractId }),
    });
    const prepText = await prepRes.text();
    if (!prepRes.ok) throw new BadRequestException(`prepare-accept failed: ${prepText.slice(0, 150)}`);
    const prep = JSON.parse(prepText);

    const commandId = `relay-preapproval-${randomUUID()}`;
    this.pending.set(userId, {
      userId, flow: 'preapproval_enable', partyId: user.partyId, commandId,
      prepared: {
        __preapproval: true,
        transaction: prep.transaction,
        txHash: prep.tx_hash,
      },
      meta: { contractId, publicKeyHex },
      createdAt: Date.now(),
    });

    this.logger.log(`prepare preapproval user=${userId.slice(0, 8)}… hash=${prep.tx_hash.slice(0, 12)}…`);
    return { flow: 'preapproval_enable', hash: prep.tx_hash, commandId, description: 'Enable instant receive (90 days)' };
  }

  /**
   * Execute preapproval via validator API submit-accept.
   * Signature: raw 32 bytes hex-decoded tx_hash, TANPA 1220 prefix, hex-encoded sig.
   */
  async executePreapproval(
    userId: string,
    signatureHex: string,
  ): Promise<{ transferPreapprovalCid: string; updateId?: string }> {
    const entry = this.pending.get(userId);
    if (!entry || entry.flow !== 'preapproval_enable') {
      throw new BadRequestException('No preapproval pending — run prepare again.');
    }
    const prep = entry.prepared as { __preapproval: boolean; transaction: string; txHash: string };
    if (!prep?.__preapproval) throw new BadRequestException('Invalid pending entry.');

    const valUrl = (this.config.get<string>('CANTON_VALIDATOR_URL') ?? '').replace(/\/$/, '');
    const token = await this.getValidatorToken();
    const pubKeyHex = (entry.meta as { publicKeyHex?: string })?.publicKeyHex;
    if (!pubKeyHex) throw new BadRequestException('publicKeyHex missing from meta.');

    const subRes = await fetch(`${valUrl}/api/validator/v0/admin/external-party/setup-proposal/submit-accept`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submission: {
          party_id: entry.partyId,
          transaction: prep.transaction,
          signed_tx_hash: signatureHex,
          public_key: pubKeyHex,
        },
      }),
    });
    const subText = await subRes.text();
    this.pending.delete(userId);

    if (subRes.ok) {
      const result = JSON.parse(subText);
      this.logger.log(`preapproval ENABLED user=${userId.slice(0, 8)}… cid=${result.transfer_preapproval_contract_id?.slice(0, 16)}…`);
      return { transferPreapprovalCid: result.transfer_preapproval_contract_id, updateId: result.update_id };
    }
    this.logger.warn(`preapproval submit failed: ${subText.slice(0, 200)}`);
    throw new BadRequestException(`Preapproval failed: ${subText.slice(0, 150)}`);
  }

  /** Get Keycloak token for validator API calls. */
  /**
   * M5b: Disable preapproval via validator API DELETE.
   * Operator (provider) has the right to cancel — no user signature needed.
   */
  async disablePreapproval(userId: string): Promise<{ ok: boolean }> {
    const user = await this.requireExternalUser(userId);
    const valUrl = (this.config.get<string>('CANTON_VALIDATOR_URL') ?? '').replace(/\/$/, '');
    if (!valUrl) throw new BadRequestException('CANTON_VALIDATOR_URL not set');
    const token = await this.getValidatorToken();

    const res = await fetch(
      `${valUrl}/api/validator/v0/admin/transfer-preapprovals/by-party/${encodeURIComponent(user.partyId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    );
    const text = await res.text();

    if (res.ok || res.status === 404) {
      this.logger.log(`preapproval disabled user=${userId.slice(0, 8)}…`);
      return { ok: true };
    }
    this.logger.warn(`preapproval disable failed: ${text.slice(0, 200)}`);
    throw new BadRequestException(`Disable failed: ${text.slice(0, 150)}`);
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
