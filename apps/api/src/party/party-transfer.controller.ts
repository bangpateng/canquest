/**
 * Kirim aset: send-cc, send-token, withdraw instruction.
 *
 * Diekstraksi dari party.controller.ts — route path & behavior identik.
 */
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { ConfigService } from '@nestjs/config';
import { FeaturedAppActivityService } from '../canton/featured-app-activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestLedgerService } from '../canton/quest-ledger.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SendCcDto } from './dto/send-cc.dto';
import { SendTokenDto } from './dto/send-token.dto';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { TransactionDetailService } from '../canton/transaction-detail.service';
import { TransferInstructionActionDto } from './dto/contract-action.dto';
import { UsersService } from '../users/users.service';
import {
  cantonPartyIdsEqual,
  looksLikeCantonPartyId,
  normalizeCantonPartyId,
} from '../common/canton-party-id';
import { hasRealWallet } from '../common/wallet-policy';
import type { AuthedReq } from './party-shared';

/** Kirim aset: send-cc, send-token, withdraw instruction. Prefix & guard sama dengan controller party lama. */
@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyTransferController {
  private readonly logger = new Logger(PartyTransferController.name);

  constructor(
    private readonly users: UsersService,
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly featuredActivity: FeaturedAppActivityService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly txDetail: TransactionDetailService,
    private readonly config: ConfigService,
    private readonly questLedger: QuestLedgerService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * In-memory mutex per-user untuk sendCc. Mencegah dua request konkuren
   * (multi-tab / double-click cepat / scripted client) lewati balance check
   * bersamaan lalu submit dua transfer. Request kedua yang masuk saat user
   * masih punya transfer in-flight langsung ditolak 409.
   * NOTE: scoped per-process — cukup untuk single-instance API. Kalau API
   * di-scale multi-instance, ganti ke Redis SET NX.
   */
  private readonly sendCcInFlight = new Set<string>();

  /**
   * Party IDs owned by the platform itself. User-to-user transfers must never
   * target these — they are the validator / reward / fee / operator wallets.
   * Returning true here blocks the send-cc flow before it touches the ledger.
   */
  private isSystemPartyId(partyId: string): boolean {
    const candidates = [
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

  @Post('send-cc')
  async sendCc(@Req() req: AuthedReq, @Body() body: SendCcDto) {
    const sender = await this.users.findById(req.user.userId);
    
    // M5: custodial path removed — reject custodial users
    if (sender?.walletKind === 'custodial') {
      throw new BadRequestException(
        'Custodial wallets are deprecated. Please upgrade to a non-custodial wallet.',
      );
    }

    if (!sender?.username || !sender.cantonPartyId) {
      throw new BadRequestException(
        'You need a wallet to send CC. Create yours first.',
      );
    }

    // Per-user mutex (Fix fund-safety #2): cegah dua transfer konkuren dari user
    // yang sama (multi-tab / double-click cepat / scripted client dengan nonce
    // beda). Tanpa ini, dua request bisa lewati balance check bersamaan lalu
    // submit dua transfer → overdraft. commandId dedup (Fix #1) hanya cover
    // nonce sama; lock ini cover nonce beda. try/finally menjamin release di
    // SEMUA jalur keluar (throw, return, crash).
    if (this.sendCcInFlight.has(sender.id)) {
      throw new ConflictException(
        'You have a transfer in progress. Please wait for it to complete.',
      );
    }
    this.sendCcInFlight.add(sender.id);
    try {
      // DTO (SendCcDto) already enforces: number, > 0, ≤ MAX_TRANSFER_CC, finite.
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('Amount must be greater than 0.');
      }

      const feeCc = Number(
        this.config.get<string>('TRANSACTION_FEE_CC') ?? '5',
      );
      const validatorPartyId =
        this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ?? '';

      const recipientInput = body.recipientUsername?.trim();
      if (!recipientInput)
        throw new BadRequestException('Recipient is required.');

      let recipientPartyId: string;
      let recipientLabel: string;
      let recipientUsername: string | null = null;

      if (looksLikeCantonPartyId(recipientInput)) {
        const normalizedRecipient = normalizeCantonPartyId(recipientInput);
        if (!normalizedRecipient) {
          throw new BadRequestException('Invalid Party ID format.');
        }
        if (cantonPartyIdsEqual(normalizedRecipient, sender.cantonPartyId)) {
          throw new BadRequestException('You cannot send CC to yourself.');
        }
        // Block transfers to platform-owned wallets (validator/reward/fee/operator).
        if (this.isSystemPartyId(normalizedRecipient)) {
          this.logger.warn(
            `Blocked send-cc to system party: user=${sender.id.slice(0, 8)} target=${normalizedRecipient.split('::')[0]} amount=${amount}`,
          );
          throw new BadRequestException(
            'Transfers to platform wallets are not allowed.',
          );
        }
        // PENTING: Canton CASE-SENSITIVE untuk submit. Pakai input CASING ASLI
        // (recipientInput, mis. Cantex::…) — bukan versi lowercase
        // (normalizedRecipient). normalizedRecipient hanya untuk matching/
        // validation di atas. Kalau lowercase dipakai submit → UNKNOWN_INFORMEES.
        recipientPartyId = recipientInput;
        recipientLabel =
          normalizedRecipient.split('::')[0] ?? normalizedRecipient;
        const found = await this.users.findByPartyId(normalizedRecipient);
        recipientUsername =
          found?.username?.toLowerCase() ?? (recipientLabel || null);
      } else {
        const username = recipientInput.replace(/^@/, '').toLowerCase();
        if (username === sender.username?.toLowerCase()) {
          throw new BadRequestException('You cannot send CC to yourself.');
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
          this.logger.warn(
            `Blocked send-cc to system wallet via @${username}: user=${sender.id.slice(0, 8)} amount=${amount}`,
          );
          throw new BadRequestException(
            'Transfers to platform wallets are not allowed.',
          );
        }
        recipientLabel = `@${username}`;
        recipientUsername = dbUser?.username?.toLowerCase() ?? username;
      }

      // Description kosong kecuali user isi memo. UI Activity/notif fallback ke
      // label generik ("Sent CC" / "Sent to {counterparty}") bila description
      // kosong — jangan tampilkan party-id mentah ("Sent to c9f5172c…").
      const description = body.memo?.trim() || '';
      const recipientDbUser = recipientUsername
        ? await this.users.findByUsernameInsensitive(recipientUsername)
        : null;
      const isInternalUser = recipientDbUser !== null;
      const effectiveFeeCc = feeCc;

      // v25: Atomic send+fee via PlatformTransfer (DAML). Feature flag
      // QUEST_ATOMIC_PLATFORM_TRANSFER (default false). Kalau ON, transfer utama +
      // platform fee jadi 1 transaction tree (all-or-nothing). Kalau gagal,
      // fallback ke path lama (2 transfer terpisah non-atomic).
      const useAtomicPlatformTransfer =
        this.config.get<string>('QUEST_ATOMIC_PLATFORM_TRANSFER') === 'true';

      // ── Balance check (DB cache — fast path) ─────
      const dbBalance = await this.prisma.ccBalance.findUnique({
        where: { userId: sender.id },
        select: { balanceMicroCc: true },
      });
      if (dbBalance) {
        const cachedCc = Number(dbBalance.balanceMicroCc) / 1_000_000;
        if (cachedCc < amount + effectiveFeeCc) {
          throw new BadRequestException(
            effectiveFeeCc > 0
              ? `Insufficient balance. Need ${amount + effectiveFeeCc} CC (${amount} transfer + ${effectiveFeeCc} platform fee).`
              : `Insufficient balance. Need ${amount} CC.`,
          );
        }
      }
      // Kalau null → ledger akan menolak jika dana kurang

      // ── Resolve casing asli on-chain (Canton case-sensitive) ──────────
      // DB simpan cantonPartyId lowercase, tapi Canton butuh casing asli
      // (mis. Cantex::… bukan cantex::…) untuk SUBMIT transfer — selain itu
      // ditolak UNKNOWN_INFORMEES. Matching/validation di atas tetap pakai
      // lowercase; resolve ini hanya untuk argumen submit ke ledger.
      const [senderPartyIdOnChain, receiverPartyIdOnChain] = await Promise.all([
        this.splice.resolveOnChainPartyId(sender.cantonPartyId),
        this.splice.resolveOnChainPartyId(recipientPartyId),
      ]);

      // ── MAIN TRANSFER via CIP-0056 ────────────────────────────────────
      // Feature flag USE_WALLET_PROXY=true → transfer via WalletUserProxy
      // (provider = app-canquest; controller = user party). Path lama tetap
      // aktif kalau flag false/unset. Proxy memungut CC app-reward hanya kalau
      // FeaturedAppRight sudah approve (Canton Foundation). Lihat
      // docs/WALLET_USER_PROXY_SETUP.md.
      let accepted = false;
      let ledgerTxId: string | undefined;
      let transferMethod: 'direct' | 'offer_accept' | 'offer_only' =
        'offer_accept';

      // v25: Atomic path (PlatformTransfer) bila flag ON. Transfer utama + fee
      // dalam 1 transaction tree. Kalau gagal, fallback ke path lama di bawah.
      // Deklarasi variabel fee di sini (dipakai atomic path + legacy path).
      let feeCollected = false;
      let feeLedgerTxId: string | undefined;

      if (
        useAtomicPlatformTransfer &&
        this.questLedger.isClaimSessionConfigured()
      ) {
        try {
          const feePartyRawAtomic =
            this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
            validatorPartyId;
          const feePartyOnChainAtomic =
            await this.splice.resolveOnChainPartyId(feePartyRawAtomic);
          // ── HYBRID: atomic if receiver preapproved, offer if not ──────────
          // AmuletRules_Transfer multi-output atomic HANYA berlaku jika SEMUA
          // receiver (termasuk transfer receiver) punya CanActAs rights utk
          // service account (custodial). Utk receiver off-preapproval, atomic
          // bypass offer system (CC masuk langsung tanpa consent) — itu
          // melanggar design intent CanQuest (DEFAULT OFF = user bisa reject).
          //
          // Strategi:
          //   - Receiver preapproved (ON) → AmuletRules_Transfer atomic (1 tx)
          //   - Receiver off-preapproval → skip atomic, fallback ke legacy
          //     offer path (TransferFactory_Transfer, receiver accept manual)
          const receiverPreapproved = await this.splice.hasTransferPreapproval(
            receiverPartyIdOnChain,
          );
          if (!receiverPreapproved) {
            this.logger.log(
              `CC atomic skipped: receiver @${receiverPartyIdOnChain.split('::')[0]} off-preapproval → offer path (2 tx)`,
            );
          } else {
            // ── ATOMIC via AmuletRules_Transfer (native CC multi-output) ────
            // CC (Amulet) punya native multi-output: 1 transfer dgn outputs array
            // [transfer, fee]. Atomic hanya utk receiver preapproved.
            const outputs: Array<{ receiver: string; amount: number }> = [
              { receiver: receiverPartyIdOnChain, amount },
            ];
            if (effectiveFeeCc > 0) {
              outputs.push({
                receiver: feePartyOnChainAtomic,
                amount: effectiveFeeCc,
              });
            }
            const amuletRes = await this.ledger.executeAmuletRulesTransferMulti(
              {
                senderPartyId: senderPartyIdOnChain,
                outputs,
                clientNonce: body.clientNonce,
              },
            );
            if (amuletRes.ok && amuletRes.updateId) {
              // Atomic sukses — transfer + fee dalam 1 tx (AmuletRules_Transfer)
              accepted = true;
              transferMethod = 'direct';
              ledgerTxId = amuletRes.updateId;
              feeCollected = effectiveFeeCc > 0;
              feeLedgerTxId = amuletRes.updateId; // sama dgn transfer (atomic, 1 tx)
              this.logger.log(
                `CC transfer ATOMIC (AmuletRules_Transfer): ${sender.username} → ${recipientLabel} ${amount} CC + fee ${effectiveFeeCc} CC (1 tx, ${outputs.length} outputs)`,
              );
              // Skip path lama (cip56Result) — atomic sudah handle transfer + fee.
              // Record history + return di bawah (setelah blok fee lama di-skip).
            } else {
              this.logger.warn(
                `Atomic AmuletRules_Transfer gagal, fallback ke path lama: ${amuletRes.error ?? 'unknown'}`,
              );
            }
          } // end if (receiverPreapproved) — else: skip atomic, go to legacy offer path
        } catch (err) {
          this.logger.warn(
            `Atomic AmuletRules_Transfer exception, fallback: ${String(err)}`,
          );
        }
      }

      // Path lama (non-atomic) — hanya bila atomic TIDAK dipakai ATAU gagal.
      // accepted=true berarti atomic sukses, skip path lama.
      let cip56Result: {
        ok: boolean;
        updateId?: string | null;
        transferKind?: string;
        error?: string;
        transferInstructionCid?: string | null;
      } | null = null;
      if (!accepted) {
        const legacy = this.ledger.useWalletProxy
          ? await this.ledger.executeProxyTransfer({
              userPartyId: senderPartyIdOnChain,
              receiverPartyId: receiverPartyIdOnChain,
              amount,
              description,
              clientNonce: body.clientNonce,
            })
          : await this.ledger.executeTransferFactoryTransfer({
              senderPartyId: senderPartyIdOnChain,
              receiverPartyId: receiverPartyIdOnChain,
              amountCc: amount,
              description,
              clientNonce: body.clientNonce,
            });
        cip56Result = legacy;

        if (legacy.ok) {
          if (legacy.transferKind === 'direct') {
            accepted = true;
            transferMethod = 'direct';
            ledgerTxId = legacy.updateId ?? undefined;
            this.logger.log(
              `CC transfer direct: ${sender.username} → ${recipientLabel} ${amount} CC`,
            );
          } else if (legacy.transferKind === 'offer') {
            // Receiver tidak punya TransferPreapproval aktif.
            // JANGAN auto-accept — biarkan pending di inbox wallet receiver.
            // User terima/reject manual via menu Offers (POST /party/offers/accept|reject).
            // ledgerTxId = Canton update_id ("1220…") supaya link explorer jalan.
            // contract_id (transferInstructionCid) disimpan di field terpisah di row.
            ledgerTxId = legacy.updateId ?? undefined;
            transferMethod = 'offer_only';
            this.logger.log(
              `CC transfer offer (pending): ${sender.username} → ${recipientLabel} ${amount} CC ` +
                `— recipient must accept via Offers menu`,
            );
          }
        }

        if (!legacy.ok) {
          throw new BadRequestException(
            `Transfer gagal: ${legacy.error?.slice(0, 120) ?? 'unknown'}`,
          );
        }
      } // end if (!accepted) — legacy path

      // ── FEE COLLECT (HANYA jika transfer berhasil DAN belum terkumpul) ────
      // (variabel feeCollected/feeLedgerTxId/feeTreasuryPartyId sudah dideklarasi
      //  di atas utk atomic path. Legacy path set di sini bila !accepted ATAU
      //  atomic sukses tapi fee belum terkumpul.)
      // ⚠️ GUARD !feeCollected: atomic path ExecuteTransfer sudah handle fee leg
      //    (transfer + fee dalam 1 tx). Tanpa guard ini, fee didouble-charge
      //    (1x di atomic, 1x di sini).
      if (
        effectiveFeeCc > 0 &&
        sender.cantonPartyId &&
        accepted &&
        !feeCollected
      ) {
        const feePartyRaw =
          this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
          validatorPartyId;
        if (feePartyRaw) {
          // Resolve casing asli fee/treasury party (env bisa lowercase) sekali,
          // dipakai untuk submit fee transfer + accept. Sender pakai versi
          // on-chain yang sudah di-resolve di atas.
          const feePartyOnChain =
            await this.splice.resolveOnChainPartyId(feePartyRaw);
          try {
            const feeResult = await this.ledger.executeTransferFactoryTransfer({
              senderPartyId: senderPartyIdOnChain,
              receiverPartyId: feePartyOnChain,
              amountCc: effectiveFeeCc,
              description: `Platform fee: ${recipientLabel}`,
            });
            if (feeResult.ok && feeResult.transferKind === 'direct') {
              feeCollected = true;
              feeLedgerTxId = feeResult.updateId ?? undefined;
              await this.users.recordTransaction({
                userId: sender.id,
                amountCc: effectiveFeeCc,
                type: 'TRANSFER_OUT',
                description: `Platform fee (transfer to ${recipientLabel})`,
                // Penanda "fee:" → filter visibility A3 sembunyikan baris ini dari history user.
                referenceId: `fee:${normalizeCantonPartyId(feePartyRaw) ?? feePartyRaw}`,
                ledgerTxId: feeLedgerTxId,
                cantonUpdateId: feeLedgerTxId,
              });
              this.logger.log(
                `Fee collected: ${sender.username} → ${feePartyRaw.split('::')[0]} ${effectiveFeeCc} CC (direct)`,
              );
            } else if (
              feeResult.ok &&
              feeResult.transferKind === 'offer' &&
              feeResult.transferInstructionCid
            ) {
              const acceptR = await this.ledger.acceptTransferInstruction(
                feeResult.transferInstructionCid,
                feePartyOnChain,
              );
              if (acceptR.ok) {
                feeCollected = true;
                feeLedgerTxId =
                  acceptR.updateId ?? feeResult.updateId ?? undefined;
                await this.users.recordTransaction({
                  userId: sender.id,
                  amountCc: effectiveFeeCc,
                  type: 'TRANSFER_OUT',
                  description: `Platform fee (transfer to ${recipientLabel})`,
                  // Penanda "fee:" → filter visibility A3 sembunyikan baris ini dari history user.
                  referenceId: `fee:${normalizeCantonPartyId(feePartyRaw) ?? feePartyRaw}`,
                  ledgerTxId: feeLedgerTxId,
                  cantonUpdateId: feeLedgerTxId,
                });
                this.logger.log(
                  `Fee collected: ${sender.username} → ${feePartyRaw.split('::')[0]} ${effectiveFeeCc} CC (offer-accept)`,
                );
              } else {
                this.logger.warn(
                  `Fee offer accept failed: transfer proceeds without fee`,
                );
              }
            } else {
              this.logger.warn(
                `Fee NOT collected (transferKind=${feeResult.transferKind}, ok=${feeResult.ok}). Transfer proceeds.`,
              );
            }
          } catch (feeErr) {
            this.logger.warn(
              `Fee collect error (non-blocking): ${String(feeErr)}`,
            );
          }
        }
      }

      // ── Step 3: Record + response ──────────────────────────────────────
      let transferTransactionId: string | undefined;
      if (accepted) {
        // Fund-safety #4: ledger SUDAH sukses (CC sudah keluar on-chain). Kalau
        // recordTransaction throw (DB down), CC pergi tanpa audit trail. Bungkus
        // agar: (a) tidak throw ke user seolah transfer gagal — transfer NYATA
        // berhasil; (b) log ALERT kuat + data lengkap supaya bisa reconcile manual;
        // (c) balance self-heal via cc-inbound-sync (≤30s). History row hilang =
        // reconcile manual dari log ini + ledgerTxId.
        try {
          const outRow = await this.users.recordTransaction({
            userId: sender.id,
            amountCc: amount,
            type: 'TRANSFER_OUT',
            description,
            counterparty: recipientPartyId,
            // ledgerTxId + cantonUpdateId = Canton update_id ("1220…") supaya link
            // explorer langsung jalan tanpa lazy-fill.
            ledgerTxId: ledgerTxId,
            cantonUpdateId: ledgerTxId,
          });
          transferTransactionId = outRow.id;
          if (ledgerTxId && sender.cantonPartyId) {
            void this.txDetail.backfillUpdateId(
              outRow.id,
              ledgerTxId,
              sender.cantonPartyId,
            );
          }
        } catch (err) {
          this.logger.error(
            `⚠️ AUDIT-TRAIL LOSS: ledger transfer SUCCEEDED but DB record failed. ` +
              `sender=${sender.id} @${sender.username} amount=${amount} CC ` +
              `recipient=${recipientLabel} ledgerTxId=${ledgerTxId ?? 'n/a'}. ` +
              `CC LEFT on-chain; balance will self-heal via sync. HISTORY ROW MISSING — ` +
              `reconcile manually from this log. Error: ${String(err)}`,
          );
        }

        if (sender.cantonPartyId) {
          void this.featuredActivity
            .recordActivity(
              'cc_transfer',
              sender.cantonPartyId,
              `CC transfer ${amount} CC to ${recipientLabel}`,
            )
            .catch(() => {});
        }

        if (isInternalUser && recipientDbUser) {
          try {
            await this.users.recordTransaction({
              userId: recipientDbUser.id,
              amountCc: amount,
              type: 'TRANSFER_IN',
              description: `Received from @${sender.username}${body.memo ? `: ${body.memo.trim()}` : ''}`,
              counterparty:
                normalizeCantonPartyId(sender.cantonPartyId) ??
                sender.cantonPartyId,
              // ledgerTxId + cantonUpdateId = Canton update_id ("1220…") — update
              // yang sama dengan row sender (satu transfer = satu ledger update).
              ledgerTxId: ledgerTxId,
              cantonUpdateId: ledgerTxId,
            });
          } catch (err) {
            // Recipient row hilang kurang kritis — recipient balance self-heal
            // via sync INCREASE branch. Tetap log supaya reconcile-aware.
            this.logger.warn(
              `Recipient TRANSFER_IN row failed (will self-heal via sync): ` +
                `recipient=${recipientDbUser.id} ledgerTxId=${ledgerTxId ?? 'n/a'}: ${String(err)}`,
            );
          }
          if (recipientDbUser.username) {
            void this.inboundSync.alignBalanceFromChain(
              recipientDbUser.id,
              recipientDbUser.username,
            );
          }
        }
        if (sender.username) {
          void this.inboundSync.alignBalanceFromChain(
            sender.id,
            sender.username,
          );
        }
      }

      // ── Offer-only: return pending status (not an error) ─────────────────
      if (transferMethod === 'offer_only') {
        // Fund-safety #4: offer SUDAH dibuat on-chain. Bungkus DB write supaya
        // kegagalan tidak tampak sebagai "transfer gagal" (offer nyata terbuat).
        let pendingRowId: string | undefined;
        try {
          const pendingRow = await this.users.recordTransaction({
            userId: sender.id,
            amountCc: amount,
            type: 'TRANSFER_OUT',
            description: `${description} [pending — recipient must accept offer]`,
            counterparty: recipientPartyId,
            ledgerTxId,
            // Status PENDING: dana sudah keluar sebagai offer, tapi belum diterima
            // receiver. Saat offer di-accept, acceptOfferInbox update ke COMPLETED.
            status: 'PENDING',
            transferInstructionCid: cip56Result?.transferInstructionCid ?? null,
          });
          pendingRowId = pendingRow.id;
        } catch (err) {
          this.logger.error(
            `⚠️ AUDIT-TRAIL LOSS (offer): offer SUCCEEDED but DB record failed. ` +
              `sender=${sender.id} @${sender.username} amount=${amount} CC ` +
              `recipient=${recipientLabel} ledgerTxId=${ledgerTxId ?? 'n/a'} ` +
              `instructionCid=${cip56Result?.transferInstructionCid ?? 'n/a'}. ` +
              `Reconcile manually. Error: ${String(err)}`,
          );
        }
        void this.inboundSync.alignBalanceFromChain(sender.id, sender.username);

        // BUG-F (P2.1) fix: push notifikasi instan ke receiver kalau dia user
        // CanQuest internal. Sebelumnya receiver hanya tau offer masuk via poll
        // /party/offers 30-60s (atau WSS Canton yang default OFF). Dengan push
        // SSE offer:new, frontend (yg sudah punya listener dari Wave 1) akan
        // refresh list offer + badge notif instan.
        // Receiver eksternal (bukan user CanQuest) tidak punya userId → skip.
        if (recipientDbUser) {
          this.realtime.push(recipientDbUser.id, 'offer:new', null);
        }

        return {
          success: true,
          from: sender.username,
          to: recipientLabel,
          amount,
          fee: feeCc,
          feeCollected,
          totalDeducted: feeCollected ? feeCc : 0,
          accepted: false,
          offerPending: true,
          offerContractId: ledgerTxId,
          message: `Transfer offer created for ${amount} CC to ${recipientLabel}. The recipient must accept this offer manually (different participant wallet). Offer ID: ${ledgerTxId?.slice(0, 20)}…`,
          transactionId: pendingRowId,
        };
      }

      const totalDeducted = amount + (feeCollected ? feeCc : 0);
      const message = `Sent ${amount} CC to ${recipientLabel} (platform fee ${feeCc} CC).`;

      return {
        success: true,
        from: sender.username,
        to: recipientLabel,
        amount,
        fee: feeCc,
        feeCollected,
        totalDeducted,
        accepted: true,
        transferMethod,
        message,
        transactionId: transferTransactionId,
      };
    } finally {
      // Fund-safety #2: wajib release lock di SEMUA jalur keluar (return/throw).
      this.sendCcInFlight.delete(sender.id);
    }
  }

  @Post('transfer-instruction/withdraw')
  async withdrawTransferInstruction(
    @Req() req: AuthedReq,
    @Body() body: TransferInstructionActionDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const cid = body.transferInstructionCid?.trim();
    if (!cid)
      throw new BadRequestException('transferInstructionCid is required.');

    this.logger.log(
      `TransferInstruction_Withdraw: user=@${user.username} cid=${cid.slice(0, 20)}...`,
    );

    // Lookup detail BEFORE exercise (offer hilang post-exercise). Pakai
    // both-directions supaya outgoing offer (sender = user) juga ketemu —
    // lookupOfferDetail lama hanya filter receiver → null untuk outgoing.
    let withdrawInstrumentId = 'Amulet';
    let withdrawInstrumentAdmin = '';
    let withdrawDetail: {
      sender: string;
      receiver: string;
      instrumentId: string;
      instrumentAdmin: string;
      amount: string;
    } | null = null;
    try {
      const detail = await this.ledger.lookupOfferDetailBothDirections(
        cid,
        user.cantonPartyId,
      );
      if (detail) {
        withdrawDetail = detail;
        withdrawInstrumentId = detail.instrumentId || 'Amulet';
        withdrawInstrumentAdmin = detail.instrumentAdmin || '';
      }
    } catch {
      /* detail tidak ketemu — fallback CC, Canton choice controller backstop */
    }

    // Defense-in-depth sender gate: hanya pemilik (sender) yang boleh withdraw.
    // Canton choice controller (TransferInstruction_Withdraw controller = sender)
    // tetap jadi backstop terakhir, tapi cek di app-level memberi pesan error
    // yang jelas sebelum operasi ledger dijalankan.
    // Case-insensitive: withdrawDetail.sender datang dari on-chain (casing asli
    // saat registrasi) sedangkan user.cantonPartyId disimpan lowercase di DB.
    if (
      withdrawDetail &&
      withdrawDetail.sender &&
      !cantonPartyIdsEqual(withdrawDetail.sender, user.cantonPartyId)
    ) {
      throw new BadRequestException(
        'You can only withdraw your own outgoing transfers.',
      );
    }

    const useProxyOffers = await this.ledger.useWalletProxyForOffers();
    const result = useProxyOffers
      ? await this.ledger.executeProxyOfferChoice({
          userPartyId: user.cantonPartyId,
          transferInstructionCid: cid,
          action: 'withdraw',
          instrumentAdmin: withdrawInstrumentAdmin,
        })
      : await this.ledger.withdrawTransferInstruction(
          cid,
          user.cantonPartyId,
          withdrawInstrumentAdmin,
        );

    if (!result.ok) {
      throw new BadRequestException(
        `Failed to withdraw transfer instruction: ${result.error ?? 'unknown error'}`,
      );
    }

    const withdrawIsNonCc = withdrawInstrumentId.toLowerCase() !== 'amulet';

    // Catat history (tx id ASLI dari exercise). Non-fatal.
    // cancelledAmount/cancelledAmountCc = jumlah ASLI offer yang ditarik (saldo
    // tidak bergerak → amount=0, tapi disimpan untuk display "cancelled X").
    const withdrawCancelledAmount = withdrawDetail?.amount
      ? Number(withdrawDetail.amount)
      : 0;
    try {
      if (withdrawIsNonCc) {
        await this.users.recordTokenTransaction({
          userId: user.id,
          instrumentId: withdrawInstrumentId,
          instrumentAdmin: withdrawInstrumentAdmin,
          amount: 0,
          type: 'TOKEN_OFFER_WITHDRAWN',
          description: `Cancelled outgoing ${withdrawInstrumentId} transfer`,
          referenceId: cid,
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
          cancelledAmount: withdrawCancelledAmount,
          // SILENT: row tetap di history, tidak push notif duplikat.
          silent: true,
        });
      } else {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0,
          type: 'OFFER_WITHDRAWN',
          description: 'Cancelled outgoing CC transfer',
          referenceId: cid,
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
          cancelledAmountCc: withdrawCancelledAmount,
          // SILENT: row tetap di history, tidak push notif duplikat.
          silent: true,
        });
      }
    } catch (err) {
      this.logger.warn(
        `OFFER_WITHDRAWN history record failed (cid=${cid.slice(0, 16)}): ${String(err)}`,
      );
    }

    if (user.username) {
      void this.inboundSync.alignBalanceFromChain(user.id, user.username);
    }

    return {
      ok: true,
      updateId: result.updateId,
      message: withdrawIsNonCc
        ? `Transfer cancelled. ${withdrawInstrumentId} returned to your wallet.`
        : 'Transfer cancelled. CC returned to your wallet.',
    };
  }

  @Post('send-token')
  async sendToken(@Req() req: AuthedReq, @Body() body: SendTokenDto) {
    const sender = await this.users.findById(req.user.userId);
    if (!sender?.username || !sender.cantonPartyId) {
      throw new BadRequestException(
        'You need a wallet to send tokens. Create yours first.',
      );
    }
    if (!hasRealWallet(sender.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    // Per-user mutex: cegah dua transfer konkuren dari user yang sama
    // (multi-tab / double-click / nonce beda). Reuse sendCcInFlight supaya user
    // tidak bisa kirim CC + token konkuren sekaligus.
    if (this.sendCcInFlight.has(sender.id)) {
      throw new ConflictException(
        'You have a transfer in progress. Please wait for it to complete.',
      );
    }
    this.sendCcInFlight.add(sender.id);
    try {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('Amount must be greater than 0.');
      }

      // CC tidak boleh lewat sini — CC pakai /send-cc (preapproval, fee path CC).
      const instrumentId = body.instrumentId.trim();
      const instrumentAdmin = body.instrumentAdmin.trim();
      if (instrumentId.toLowerCase() === 'amulet') {
        throw new BadRequestException(
          'Use /send-cc for Canton Coin (CC) transfers.',
        );
      }
      if (!instrumentId || !instrumentAdmin) {
        throw new BadRequestException(
          'instrumentId and instrumentAdmin are required for token transfer.',
        );
      }

      // ── Resolve recipient (username atau party id) — mirror sendCc ────
      const recipientInput = body.recipientUsername?.trim();
      if (!recipientInput) {
        throw new BadRequestException('Recipient is required.');
      }

      let recipientPartyId: string;
      let recipientLabel: string;

      if (looksLikeCantonPartyId(recipientInput)) {
        const normalizedRecipient = normalizeCantonPartyId(recipientInput);
        if (!normalizedRecipient) {
          throw new BadRequestException('Invalid Party ID format.');
        }
        if (cantonPartyIdsEqual(normalizedRecipient, sender.cantonPartyId)) {
          throw new BadRequestException('You cannot send tokens to yourself.');
        }
        if (this.isSystemPartyId(normalizedRecipient)) {
          this.logger.warn(
            `Blocked send-token to system party: user=${sender.id.slice(0, 8)} target=${normalizedRecipient.split('::')[0]} amount=${amount} ${instrumentId}`,
          );
          throw new BadRequestException(
            'Transfers to platform wallets are not allowed.',
          );
        }
        // PENTING: Canton CASE-SENSITIVE untuk submit. Pakai input CASING ASLI
        // (recipientInput, mis. Cantex::…) — bukan lowercase (normalizedRecipient)
        // yang hanya untuk matching/validation di atas.
        recipientPartyId = recipientInput;
        recipientLabel =
          normalizedRecipient.split('::')[0] ?? normalizedRecipient;
      } else {
        const username = recipientInput.replace(/^@/, '').toLowerCase();
        if (username === sender.username?.toLowerCase()) {
          throw new BadRequestException('You cannot send tokens to yourself.');
        }
        const dbUser = await this.users.findByUsernameInsensitive(username);
        const resolved =
          dbUser?.cantonPartyId ?? (await this.splice.getUserPartyId(username));
        if (!resolved) {
          throw new BadRequestException(
            `User "@${username}" not found or has no wallet.`,
          );
        }
        // VALIDATE: recipient must have a REAL Canton wallet (not placeholder).
        // Placeholder party (canquest::...) tidak terdaftar di Canton Network
        // synchronizer → transfer akan gagal dengan UNKNOWN_INFORMEES.
        if (!hasRealWallet(resolved)) {
          throw new BadRequestException(
            `User "@${username}" has no Canton wallet yet. ` +
              'They need to create a wallet first to receive tokens.',
          );
        }
        recipientPartyId = normalizeCantonPartyId(resolved) ?? resolved;
        if (this.isSystemPartyId(recipientPartyId)) {
          this.logger.warn(
            `Blocked send-token to system wallet via @${username}: user=${sender.id.slice(0, 8)} amount=${amount} ${instrumentId}`,
          );
          throw new BadRequestException(
            'Transfers to platform wallets are not allowed.',
          );
        }
        recipientLabel = `@${username}`;
      }

      // Description kosong kecuali user isi memo. UI fallback ke label generik.
      const description = body.memo?.trim() || '';

      // ── Balance pre-check ON-CHAIN (sumber kebenaran untuk token non-CC) ──
      // CantexTokenBalance (DB) bisa drift (swap kredit DB walau on-chain gagal)
      // → jangan dipakai untuk validate send-token. getTokenBalanceOnChain baca
      // ACS on-chain via InterfaceFilter (bukan WildcardFilter yang return [] untuk
      // interface-only contract seperti USDCx).
      let onChainBalance = 0;
      try {
        onChainBalance = await this.ledger.getTokenBalanceOnChain(
          sender.cantonPartyId,
          instrumentId,
        );
      } catch (err) {
        this.logger.warn(
          `getTokenBalanceOnChain failed for send-token pre-check: ${String(err)} — proceeding (ledger akan reject bila dana kurang)`,
        );
      }

      const feeCc = Number(
        this.config.get<string>('TRANSACTION_FEE_CC') ?? '5',
      );

      if (onChainBalance > 0 && onChainBalance < amount) {
        throw new BadRequestException(
          `Insufficient on-chain ${instrumentId} balance. Need ${amount}, have ${onChainBalance.toFixed(6)}.`,
        );
      }

      // CC fee pre-check (DB cache — fast path). Fee in CC, jadi sender butuh CC.
      if (feeCc > 0) {
        const dbCcBal = await this.prisma.ccBalance.findUnique({
          where: { userId: sender.id },
          select: { balanceMicroCc: true },
        });
        const cachedCc = dbCcBal
          ? Number(dbCcBal.balanceMicroCc) / 1_000_000
          : 0;
        if (cachedCc < feeCc) {
          throw new BadRequestException(
            `Insufficient CC for fee. Need ${feeCc} CC (platform fee for token transfer).`,
          );
        }
      }

      // ── MAIN TRANSFER via CIP-0056 (on-chain, two-step) ───────────────
      this.logger.log(
        `send-token: ${sender.username} → ${recipientLabel} ${amount} ${instrumentId} ` +
          `(admin=${instrumentAdmin.slice(0, 12)}...) nonce=${body.clientNonce.slice(0, 8)}`,
      );

      // ── Resolve casing asli on-chain (Canton case-sensitive) ──────────
      // DB simpan cantonPartyId lowercase, Canton butuh casing asli (mis.
      // Cantex::…) untuk SUBMIT — selain itu UNKNOWN_INFORMEES.
      const [senderPartyIdOnChain, receiverPartyIdOnChain] = await Promise.all([
        this.splice.resolveOnChainPartyId(sender.cantonPartyId),
        this.splice.resolveOnChainPartyId(recipientPartyId),
      ]);

      // ── v28: Atomic send-token+fee via Splice BatchTransfer (native) ────────
      // Feature flag QUEST_ATOMIC_PLATFORM_TRANSFER (sama dgn sendCc). Kalau ON,
      // transfer utama (non-CC) + platform fee (CC) jadi 1 tx via
      // WalletUserProxy_BatchTransfer (transferCalls array). Pattern Splice
      // native dgn holding threading otomatis.
      // Kalau gagal, fallback ke path lama (2 transfer terpisah di bawah).
      const useAtomicPlatformTransferToken =
        this.config.get<string>('QUEST_ATOMIC_PLATFORM_TRANSFER') === 'true';
      let atomicLedgerTxId: string | undefined;

      if (
        useAtomicPlatformTransferToken &&
        this.questLedger.isClaimSessionConfigured()
      ) {
        try {
          const feePartyRawToken =
            this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
            (this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ?? '');
          const feePartyOnChainToken =
            await this.splice.resolveOnChainPartyId(feePartyRawToken);
          // ── ATOMIC via Splice native BatchTransfer ──────────────────────
          // Leg 1: token transfer (USDCx dll, non-CC)
          // Leg 2: fee (CC/Amulet) — instrument berbeda, pool berbeda, tidak conflict.
          const transfersToken: Array<{
            receiverPartyId: string;
            amount: number;
            instrumentId: string;
            instrumentAdmin: string;
            description?: string;
          }> = [
            {
              receiverPartyId: receiverPartyIdOnChain,
              amount,
              instrumentId,
              instrumentAdmin,
              description,
            },
          ];
          if (feeCc > 0) {
            transfersToken.push({
              receiverPartyId: feePartyOnChainToken,
              amount: feeCc,
              instrumentId: 'Amulet',
              instrumentAdmin:
                this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '',
              description: `Platform fee: ${recipientLabel}`,
            });
          }
          const batchResToken =
            await this.ledger.executeProxyBatchTransferMulti({
              senderPartyId: senderPartyIdOnChain,
              transfers: transfersToken,
            });
          if (batchResToken.ok && batchResToken.updateId) {
            atomicLedgerTxId = batchResToken.updateId;
            this.logger.log(
              `Token transfer ATOMIC (BatchTransfer): ${sender.username} → ${recipientLabel} ${amount} ${instrumentId} + fee ${feeCc} CC (1 tx, ${transfersToken.length} legs)`,
            );
            // Record history (instrument-aware). Non-CC: offer (receiver accept manual).
            try {
              const row = await this.users.recordTokenTransaction({
                userId: sender.id,
                instrumentId,
                instrumentAdmin,
                amount,
                type: 'TOKEN_TRANSFER_OUT',
                description,
                referenceId:
                  normalizeCantonPartyId(recipientPartyId) ?? recipientPartyId,
                ledgerTxId: atomicLedgerTxId,
                cantonUpdateId: atomicLedgerTxId,
                status: 'PENDING',
                transferInstructionCid: null,
              });
              // fee record (CC, atomic = 1 tx dgn transfer)
              await this.users.recordTransaction({
                userId: sender.id,
                amountCc: feeCc,
                type: 'TRANSFER_OUT',
                description: `Platform fee (token transfer to ${recipientLabel})`,
                referenceId: `fee:${normalizeCantonPartyId(feePartyRawToken) ?? feePartyRawToken}`,
                ledgerTxId: atomicLedgerTxId,
                cantonUpdateId: atomicLedgerTxId,
              });
              return {
                ok: true,
                message: `${amount} ${instrumentId} sent to ${recipientLabel} (atomic w/ fee). Recipient may need to accept via Offers menu.`,
                ledgerTxId: atomicLedgerTxId,
                transferInstructionCid: null,
                transactionId: row.id,
                feeCollected: true,
                feeLedgerTxId: atomicLedgerTxId,
              };
            } catch (recErr) {
              this.logger.warn(
                `Atomic token history record failed (transfer committed, updateId=${atomicLedgerTxId.slice(0, 12)}): ${String(recErr)}`,
              );
              return {
                ok: true,
                message: `${amount} ${instrumentId} sent to ${recipientLabel} (atomic w/ fee). History record pending.`,
                ledgerTxId: atomicLedgerTxId,
                transferInstructionCid: null,
                transactionId: undefined,
                feeCollected: true,
                feeLedgerTxId: atomicLedgerTxId,
              };
            }
          } else {
            this.logger.warn(
              `Atomic BatchTransfer (token) gagal, fallback ke path lama: ${batchResToken.error ?? 'unknown'}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `Atomic BatchTransfer (token) exception, fallback: ${String(err)}`,
          );
        }
      }

      const cip56Result = this.ledger.useWalletProxy
        ? await this.ledger.executeProxyTransfer({
            userPartyId: senderPartyIdOnChain,
            receiverPartyId: receiverPartyIdOnChain,
            amount,
            description,
            clientNonce: body.clientNonce,
            instrumentId,
            instrumentAdmin,
          })
        : await this.ledger.executeTransferFactoryTransfer({
            senderPartyId: senderPartyIdOnChain,
            receiverPartyId: receiverPartyIdOnChain,
            amountCc: amount,
            description,
            clientNonce: body.clientNonce,
            instrumentId,
            instrumentAdmin,
          });

      if (!cip56Result.ok) {
        throw new BadRequestException(
          `Token transfer failed: ${cip56Result.error?.slice(0, 160) ?? 'unknown error'}`,
        );
      }

      const ledgerTxId = cip56Result.updateId ?? undefined;
      const transferInstructionCid =
        cip56Result.transferInstructionCid ?? undefined;

      // Untuk non-CC, transferKind hampir pasti "offer" (no preapproval).
      // Offer dibuat = transfer utama SUDAH submitted on-chain → fee applicable.
      const submitted =
        cip56Result.transferKind === 'offer' ||
        cip56Result.transferKind === 'direct';

      this.logger.log(
        `send-token OK: ${sender.username} → ${recipientLabel} ${amount} ${instrumentId} ` +
          `kind=${cip56Result.transferKind}` +
          (transferInstructionCid
            ? ` instructionCid=${transferInstructionCid.slice(0, 16)}...`
            : '') +
          ` — recipient must accept via Offers menu`,
      );

      // ── Record history (TokenTransaction, instrument-aware) ───────────
      let transactionId: string | undefined;
      try {
        const row = await this.users.recordTokenTransaction({
          userId: sender.id,
          instrumentId,
          instrumentAdmin,
          amount,
          type: 'TOKEN_TRANSFER_OUT',
          description,
          // referenceId = partyId penerima (TANPA prefix "to:"). Prefix lama bikin
          // resolveTransferCounterparty gagal match → counterparty tampil "to:karel…".
          referenceId:
            normalizeCantonPartyId(recipientPartyId) ?? recipientPartyId,
          ledgerTxId: ledgerTxId ?? transferInstructionCid,
          cantonUpdateId: ledgerTxId ?? undefined,
          status: 'PENDING', // offer belum di-accept receiver
          transferInstructionCid: transferInstructionCid ?? null,
        });
        transactionId = row.id;
      } catch (err) {
        this.logger.warn(
          `TOKEN_TRANSFER_OUT history record failed: ${String(err)}`,
        );
      }

      // ── FEE COLLECT (CC, non-blocking, mirror sendCc) ─────────────────
      let feeCollected = false;
      if (feeCc > 0 && submitted) {
        const validatorPartyId =
          this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ?? '';
        const feePartyRaw =
          this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
          validatorPartyId;
        if (feePartyRaw) {
          // Resolve casing asli fee/treasury party (env bisa lowercase); sender
          // pakai versi on-chain yang sudah di-resolve di atas.
          const feePartyOnChain =
            await this.splice.resolveOnChainPartyId(feePartyRaw);
          try {
            const feeResult = await this.ledger.executeTransferFactoryTransfer({
              senderPartyId: senderPartyIdOnChain,
              receiverPartyId: feePartyOnChain,
              amountCc: feeCc,
              description: `Platform fee: ${recipientLabel} (${instrumentId})`,
            });
            if (feeResult.ok && feeResult.transferKind === 'direct') {
              feeCollected = true;
              await this.users.recordTransaction({
                userId: sender.id,
                amountCc: feeCc,
                type: 'TRANSFER_OUT',
                description: `Platform fee (token transfer to ${recipientLabel})`,
                referenceId: `fee:${normalizeCantonPartyId(feePartyRaw) ?? feePartyRaw}`,
                ledgerTxId: feeResult.updateId ?? undefined,
                cantonUpdateId: feeResult.updateId ?? undefined,
              });
            } else if (
              feeResult.ok &&
              feeResult.transferKind === 'offer' &&
              feeResult.transferInstructionCid
            ) {
              // Fee offer perlu di-accept oleh fee party (auto, mirror sendCc:836).
              const acceptR = await this.ledger.acceptTransferInstruction(
                feeResult.transferInstructionCid,
                feePartyOnChain,
              );
              if (acceptR.ok) {
                feeCollected = true;
                await this.users.recordTransaction({
                  userId: sender.id,
                  amountCc: feeCc,
                  type: 'TRANSFER_OUT',
                  description: `Platform fee (token transfer to ${recipientLabel})`,
                  referenceId: `fee:${normalizeCantonPartyId(feePartyRaw) ?? feePartyRaw}`,
                  ledgerTxId:
                    acceptR.updateId ?? feeResult.updateId ?? undefined,
                  cantonUpdateId:
                    acceptR.updateId ?? feeResult.updateId ?? undefined,
                });
              } else {
                this.logger.warn(
                  `Fee offer accept failed (token transfer): transfer proceeds without fee`,
                );
              }
            }
          } catch (feeErr) {
            this.logger.warn(
              `Fee collect error (token transfer, non-blocking): ${String(feeErr)}`,
            );
          }
        }
      }

      // BUG-F (P2.1) fix: push notifikasi instan ke receiver kalau dia user
      // CanQuest internal DAN offer dibuat (offerPending). Sebelumnya receiver
      // hanya tau offer masuk via poll /party/offers 30-60s (atau WSS Canton
      // yang default OFF). Dengan push SSE offer:new, frontend refresh list
      // offer + badge notif instan. Receiver eksternal (bukan user CanQuest)
      // tidak punya userId → skip.
      if (cip56Result.transferKind === 'offer') {
        try {
          const receiver = await this.users.findByPartyId(recipientPartyId);
          if (receiver) {
            this.realtime.push(receiver.id, 'offer:new', null);
          }
        } catch (err) {
          // Non-fatal: notif gagal tidak boleh gagalkan transfer (sudah sukses).
          this.logger.warn(
            `offer:new push to receiver failed (transfer tetap sukses): ${String(err)}`,
          );
        }
      }

      return {
        ok: true,
        success: true,
        instrumentId,
        amount,
        from: sender.username,
        to: recipientLabel,
        fee: feeCc,
        feeCollected,
        transferKind: cip56Result.transferKind,
        transferInstructionCid,
        offerPending: cip56Result.transferKind === 'offer',
        // Prefix "tok-" wajib: detail endpoint /transactions/:id pakai prefix untuk
        // bedakan TokenTransaction vs CcTransaction. Tanpa prefix, dicari di tabel CC
        // → "Transaction not found" saat modal receipt dibuka langsung.
        transactionId: transactionId ? `tok-${transactionId}` : undefined,
        message:
          cip56Result.transferKind === 'offer'
            ? `Sent ${amount} ${instrumentId} to ${recipientLabel}. Recipient must accept via Offers menu. Offer ID: ${transferInstructionCid?.slice(0, 20) ?? ledgerTxId?.slice(0, 20) ?? '?'}…`
            : `Sent ${amount} ${instrumentId} to ${recipientLabel}.`,
      };
    } finally {
      // Fund-safety: wajib release lock di SEMUA jalur keluar.
      this.sendCcInFlight.delete(sender.id);
    }
  }
}
