/**
 * Offer inbox: daftar, accept, reject (CIP-56 + legacy).
 *
 * Diekstraksi dari party.controller.ts — route path & behavior identik.
 */
import { AuthGuard } from '@nestjs/passport';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { ContractActionDto, OfferType } from './dto/contract-action.dto';
import { PrismaService } from '../prisma/prisma.service';
import { SkipThrottle } from '@nestjs/throttler';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { UsersService } from '../users/users.service';
import { hasRealWallet } from '../common/wallet-policy';
import type { AuthedReq } from './party-shared';

/** Offer inbox: daftar, accept, reject (CIP-56 + legacy). Prefix & guard sama dengan controller party lama. */
@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyOfferController {
  private readonly logger = new Logger(PartyOfferController.name);

  constructor(
    private readonly users: UsersService,
    private readonly ledger: CantonLedgerService,
    private readonly splice: SpliceValidatorService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * BUG-E fix: in-memory mutex per-CID untuk accept/reject offer. Mencegah
   * double-submit paralel (mis. user buka 2 tab dan klik Accept bersamaan, atau
   * Accept + Reject pada cid yang sama hampir bersamaan).
   *
   * Sebelumnya tidak ada mutex — kedua request lolos wallet check, dua-duanya
   * panggil choice DAML (`TransferInstruction_Accept`/`_Reject`). Canton sendiri
   * backstop (contract ter-archive setelah choice pertama, choice kedua gagal),
   * tapi error ke user membingungkan + race pada insert row history.
   *
   * Set dipakai BERSAMA untuk accept & reject (cid sama tidak boleh di-exercise
   * dua choice berbeda secara paralel). Key = cid penuh.
   * NOTE: scoped per-process — cukup untuk single-instance API. Multi-instance
   * butuh Redis SET NX.
   */
  private readonly offerActionInFlight = new Set<string>();

  // ═══════════════════════════════════════════════════════════════════════════
  // Offer Inbox — list and manage incoming transfer offers
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * List all pending transfer offers for the current user.
   *
   * Direction:
   *  - default / 'incoming' → offers where user is RECEIVER (Accept/Reject)
   *  - 'outgoing'           → offers where user is SENDER (Withdraw)
   *
   * Returns both legacy Splice TransferOffers and CIP-0056 TransferInstructions.
   */
  @SkipThrottle()
  @Get('offers')
  async listOffers(
    @Req() req: AuthedReq,
    @Query('direction') direction?: string,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }

    const dir: 'incoming' | 'outgoing' =
      direction === 'outgoing' ? 'outgoing' : 'incoming';

    let offers = await this.ledger.queryPendingOffers(user.cantonPartyId, dir);

    // Fallback: kalau ACS kosong, coba Splice Wallet API langsung
    if (offers.length === 0 && user.username) {
      const spliceOffers = await this.splice.listTransferOffers(user.username);
      if (spliceOffers.length > 0) {
        offers = spliceOffers.map((o) => ({
          type: 'transfer_offer' as const,
          contractId: o.contractId,
          sender: '',
          receiver: user.cantonPartyId!,
          amount: '0',
          description: 'Incoming transfer (Splice Wallet)',
          expiresAt: '',
          createdAt: '',
          // Splice fallback tidak expose instrument → default CC.
          instrumentId: 'Amulet',
          instrumentAdmin: '',
        }));
        this.logger.log(
          `Fallback Splice: ${offers.length} offers for @${user.username}`,
        );
      }
    }

    // Resolve labels from DB where possible.
    // - Incoming: enrich senderLabel (untuk UI "from @ali")
    // - Outgoing: enrich receiverLabel (untuk UI "→ @budi")
    const enriched = await Promise.all(
      offers.map(async (offer) => {
        let senderLabel = offer.sender.split('::')[0] ?? offer.sender;
        let receiverLabel = offer.receiver.split('::')[0] ?? offer.receiver;
        try {
          const senderUser = await this.users.findByPartyId(offer.sender);
          if (senderUser?.username) senderLabel = `@${senderUser.username}`;
        } catch {
          /* keep party hint */
        }
        try {
          const receiverUser = await this.users.findByPartyId(offer.receiver);
          if (receiverUser?.username)
            receiverLabel = `@${receiverUser.username}`;
        } catch {
          /* keep party hint */
        }
        return { ...offer, senderLabel, receiverLabel };
      }),
    );

    return {
      offers: enriched,
      total: enriched.length,
      direction: dir,
      legacyCount: enriched.filter((o) => o.type === 'transfer_offer').length,
      cip56Count: enriched.filter((o) => o.type === 'transfer_instruction')
        .length,
    };
  }

  @Post('offers/accept')
  async acceptOfferInbox(
    @Req() req: AuthedReq,
    @Body() body: ContractActionDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (
      !user?.cantonPartyId ||
      !user.username ||
      !hasRealWallet(user.cantonPartyId)
    ) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const cid = body.contractId?.trim();
    if (!cid) throw new BadRequestException('contractId is required.');

    // BUG-E: mutex per-CID — cegah double-submit paralel (Accept dari 2 tab,
    // atau Accept+Reject hampir bersamaan pada cid yang sama). Set BERSAMA
    // dengan reject (cid tidak boleh di-exercise 2 choice paralel).
    if (this.offerActionInFlight.has(cid)) {
      throw new ConflictException(
        'This transfer is already being processed. Please wait a moment and refresh.',
      );
    }
    this.offerActionInFlight.add(cid);
    try {
      return await this.doAcceptOfferInbox(user, body, cid);
    } finally {
      this.offerActionInFlight.delete(cid);
    }
  }

  private async doAcceptOfferInbox(
    user: { id: string; username: string | null; cantonPartyId: string | null },
    body: ContractActionDto,
    cid: string,
  ) {
    // Narrow tipe ke non-null (sudah di-guard oleh caller acceptOfferInbox:
    // `if (!user?.cantonPartyId || !user.username || !hasRealWallet(...))`).
    // Assertion di sini supaya TypeScript narrow di body helper.
    if (!user.cantonPartyId || !user.username) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const partyId = user.cantonPartyId;
    const offerType = body.type ?? OfferType.TRANSFER_OFFER;
    this.logger.log(
      `Accept offer: user=@${user.username} type=${offerType} cid=${cid.slice(0, 20)}...`,
    );

    // Lookup detail offer SEBELUM accept — setelah accept, offer hilang dari ledger.
    // amount + sender + instrument ini dipakai untuk catat history yang truthful.
    let amountCc = 0;
    let senderLabel = '';
    let offerInstrumentId = 'Amulet';
    let offerInstrumentAdmin = '';
    try {
      const detail = await this.ledger.lookupOfferDetail(cid, partyId);
      if (detail) {
        amountCc = parseFloat(detail.amount) || 0;
        senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
        offerInstrumentId = detail.instrumentId || 'Amulet';
        offerInstrumentAdmin = detail.instrumentAdmin || '';
      }
    } catch (err) {
      this.logger.warn(`lookupOfferDetail (accept) failed: ${String(err)}`);
    }
    const isNonCcToken = offerInstrumentId.toLowerCase() !== 'amulet';

    let ok = false;
    let updateId: string | null = null;

    if (offerType === OfferType.TRANSFER_INSTRUCTION) {
      // CIP-0056 TransferInstruction — route via WalletUserProxy HANYA kalau
      // FAR ada (offers proxy choices butuh featuredAppRightCid WAJIB, no fallback).
      // Kalau FAR belum approve → path lama (acceptTransferInstruction).
      const useProxyOffers = await this.ledger.useWalletProxyForOffers();
      const result = useProxyOffers
        ? await this.ledger.executeProxyOfferChoice({
            userPartyId: partyId,
            transferInstructionCid: cid,
            action: 'accept',
            instrumentAdmin: offerInstrumentAdmin,
          })
        : await this.ledger.acceptTransferInstruction(cid, partyId);
      ok = result.ok;
      updateId = result.updateId;
      if (!ok) {
        throw new BadRequestException(
          `Failed to accept: ${result.error ?? 'unknown'}`,
        );
      }
    } else {
      // Legacy Splice TransferOffer — accept via Canton Ledger API.
      const result = await this.ledger.acceptTransferOffer(cid, partyId);
      ok = result.accepted;
      updateId = result.updateId;
      if (!ok) {
        throw new BadRequestException('Failed to accept transfer offer.');
      }
    }

    // Reward yang tadinya PENDING (offer) kini diterima → tandai COMPLETED.
    // Jika baris reward kita yang cocok, JANGAN catat TRANSFER_IN baru: baris
    // reward sudah punya angka yang benar. Hanya transfer dari pihak lain yang dicatat.
    let settledOwnReward = 0;
    try {
      settledOwnReward = await this.users.markTransferInstructionSettled(
        cid,
        'COMPLETED',
        updateId ?? undefined,
      );
    } catch (err) {
      this.logger.warn(`markTransferInstructionSettled failed: ${String(err)}`);
    }

    if (settledOwnReward === 0) {
      // (legacy branch) Reward pending kita TIDAK ditemukan → lanjut catat
      // TRANSFER_IN untuk penerima di bawah.
    }

    // ── PENERIMA selalu dapat history saat accept (Fix UX) ──────────────
    // Branch: token non-CC → TokenTransaction (instrument-aware); CC → CcTransaction.
    {
      if (isNonCcToken) {
        // Token non-CC: catat ke TokenTransaction. amount = amountCc (decimal,
        // bukan micro). CC balance delta tidak relevan — lewati resolve-delta.
        const kindLabel =
          offerType === OfferType.TRANSFER_INSTRUCTION ? 'CIP-0056' : 'legacy';
        try {
          await this.users.recordTokenTransaction({
            userId: user.id,
            instrumentId: offerInstrumentId,
            instrumentAdmin: offerInstrumentAdmin,
            amount: amountCc,
            type: 'TOKEN_TRANSFER_IN',
            description:
              amountCc > 0
                ? `Received ${amountCc} ${offerInstrumentId}${senderLabel ? ` from ${senderLabel}` : ''}`
                : `Accepted incoming ${kindLabel} ${offerInstrumentId} transfer`,
            referenceId: senderLabel || undefined,
            ledgerTxId: updateId ?? cid,
            cantonUpdateId: updateId ?? undefined,
            // Receiver dapat 1 notif dari sini. Token non-CC TIDAK dipantau WSS
            // handler → tidak akan double. CC dipantau WSS tapi handler punya
            // dedup cantonUpdateId → bila controller catat duluan, WSS skip push.
          });
        } catch (err) {
          // P2002 = idempotent retry → OK. Error lain = audit loss (non-fatal).
          this.logger.warn(
            `Recipient TOKEN_TRANSFER_IN on accept failed (cid=${cid.slice(0, 16)}…): ${String(err)}`,
          );
        }
      } else {
        // CC: jalur lama — resolve amount via delta balance on-chain kalau 0.
        let resolvedAmount = amountCc;
        if (resolvedAmount === 0) {
          try {
            const afterBal = await this.ledger.getLedgerBalance(partyId);
            if (afterBal != null) {
              const beforeRow = await this.prisma.ccBalance.findUnique({
                where: { userId: user.id },
              });
              const beforeCc = beforeRow
                ? Number(beforeRow.balanceMicroCc) / 1_000_000
                : 0;
              resolvedAmount = Math.max(
                0,
                Math.round((afterBal - beforeCc) * 1e6) / 1e6,
              );
            }
          } catch (err) {
            this.logger.warn(
              `balance-delta amount resolve failed: ${String(err)}`,
            );
          }
        }

        const kindLabel =
          offerType === OfferType.TRANSFER_INSTRUCTION ? 'CIP-0056' : 'legacy';
        try {
          await this.users.recordTransaction({
            userId: user.id,
            amountCc: resolvedAmount,
            type: 'TRANSFER_IN',
            description:
              resolvedAmount > 0
                ? `Received ${resolvedAmount} CC${senderLabel ? ` from ${senderLabel}` : ''}`
                : `Accepted incoming ${kindLabel} transfer`,
            counterparty: senderLabel || undefined,
            // Preferensi Canton update_id ("1220…") untuk link explorer; fallback
            // contract_id (cid) bila ledger response tidak ter-parse.
            ledgerTxId: updateId ?? cid,
            cantonUpdateId: updateId ?? undefined,
            // Receiver dapat 1 notif dari sini. WSS handler punya dedup
            // cantonUpdateId → bila controller catat duluan, WSS skip push-nya.
          });
        } catch (err) {
          // Unique constraint (P2002) = row sudah ada (idempotent retry) → OK.
          // Error lain = audit-trail loss untuk penerima; balance self-heal via sync.
          this.logger.warn(
            `Recipient TRANSFER_IN on accept failed (cid=${cid.slice(0, 16)}…): ${String(err)}`,
          );
        }
      }
    }

    if (user.username) {
      // CC balance self-heal (token non-CC tidak terpengaruh — aman dipanggil).
      void this.inboundSync.alignBalanceFromChain(user.id, user.username);
    }

    return {
      ok: true,
      updateId,
      message: isNonCcToken
        ? `Transfer accepted. ${offerInstrumentId} will appear in your wallet shortly.`
        : 'Transfer accepted. CC will appear in your wallet shortly.',
    };
  }

  @Post('offers/reject')
  async rejectOfferInbox(
    @Req() req: AuthedReq,
    @Body() body: ContractActionDto,
  ) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const cid = body.contractId?.trim();
    if (!cid) throw new BadRequestException('contractId is required.');

    // BUG-E: mutex per-CID (shared dengan accept). Cegah Reject paralel dengan
    // Accept atau Reject lain pada cid yang sama.
    if (this.offerActionInFlight.has(cid)) {
      throw new ConflictException(
        'This transfer is already being processed. Please wait a moment and refresh.',
      );
    }
    this.offerActionInFlight.add(cid);
    try {
      return await this.doRejectOfferInbox(user, body, cid);
    } finally {
      this.offerActionInFlight.delete(cid);
    }
  }

  private async doRejectOfferInbox(
    user: { id: string; username: string | null; cantonPartyId: string | null },
    body: ContractActionDto,
    cid: string,
  ) {
    // Narrow tipe ke non-null (sudah di-guard oleh caller rejectOfferInbox:
    // `if (!user?.cantonPartyId || !hasRealWallet(...))`).
    if (!user.cantonPartyId) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const partyId = user.cantonPartyId;
    const offerType = body.type ?? OfferType.TRANSFER_OFFER;
    this.logger.log(
      `Reject offer: user=@${user.username} type=${offerType} cid=${cid.slice(0, 20)}...`,
    );

    if (offerType === OfferType.TRANSFER_INSTRUCTION) {
      // Lookup detail SEBELUM reject — setelah reject, offer hilang dari ledger.
      let amountCc = 0;
      let senderLabel = '';
      try {
        const detail = await this.ledger.lookupOfferDetail(cid, partyId);
        if (detail) {
          amountCc = parseFloat(detail.amount) || 0;
          senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
        }
      } catch (err) {
        this.logger.warn(`lookupOfferDetail (reject) failed: ${String(err)}`);
      }

      const useProxyOffers = await this.ledger.useWalletProxyForOffers();
      const result = useProxyOffers
        ? await this.ledger.executeProxyOfferChoice({
            userPartyId: partyId,
            transferInstructionCid: cid,
            action: 'reject',
          })
        : await this.ledger.rejectTransferInstruction(cid, partyId);
      if (!result.ok) {
        throw new BadRequestException(
          `Failed to reject: ${result.error ?? 'unknown'}`,
        );
      }

      // Reward PENDING yang ditolak → tandai REJECTED. Transfer dari pihak lain
      // yang ditolak → catat jejak OFFER_REJECTED (amount 0) supaya user punya
      // riwayatnya. Konsisten dengan legacy branch di bawah dan rejectTransferInstruction.
      try {
        await this.users.markTransferInstructionSettled(
          cid,
          'REJECTED',
          result.updateId ?? undefined,
        );
      } catch (err) {
        this.logger.warn(
          `markTransferInstructionSettled REJECTED failed: ${String(err)}`,
        );
      }
      // ── PENERIMA selalu dapat history OFFER_REJECTED saat reject (Fix UX) ──
      // Sebelumnya: recordTransaction OFFER_REJECTED hanya jalan kalau
      // settledOwnReward === 0. Tapi markTransferInstructionSettled match row
      // PENDING global (milik SENDER) → return >0 → blok di-skip → PENERIMA
      // tidak dapat history reject. Cegah double via unique constraint
      // @@unique([userId, ledgerTxId]), bukan via settledOwnReward.
      try {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0, // reject tidak menggerakkan saldo receiver
          type: 'OFFER_REJECTED',
          description:
            `Rejected incoming transfer${senderLabel ? ` from ${senderLabel}` : ''}` +
            (amountCc > 0 ? ` (${amountCc} CC)` : ''),
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
          // Jumlah ASLI offer yang ditolak — disimpan untuk display "cancelled X CC".
          cancelledAmountCc: amountCc,
          // SILENT: row tetap di history, tapi tidak push notif duplikat
          // (sender sudah dapat notif dari markTransferInstructionSettled).
          silent: true,
        });
      } catch (err) {
        this.logger.warn(
          `Recipient OFFER_REJECTED on reject failed (cid=${cid.slice(0, 16)}…): ${String(err)}`,
        );
      }
      return {
        ok: true,
        updateId: result.updateId,
        message: 'Transfer rejected. CC returned to sender.',
      };
    } else {
      // Legacy Splice TransferOffer — lookup detail SEBELUM reject (offer hilang setelahnya).
      let amountCc = 0;
      let senderLabel = '';
      try {
        const detail = await this.ledger.lookupOfferDetail(cid, partyId);
        if (detail) {
          amountCc = parseFloat(detail.amount) || 0;
          senderLabel = detail.sender?.split('::')[0] ?? detail.sender ?? '';
        }
      } catch (err) {
        this.logger.warn(
          `lookupOfferDetail (legacy reject) failed: ${String(err)}`,
        );
      }

      const result = await this.ledger.rejectTransferOffer(cid, partyId);
      if (!result.rejected) {
        throw new BadRequestException('Failed to reject transfer offer.');
      }

      // Reward PENDING yang ditolak → tandai REJECTED. Transfer dari pihak lain
      // yang ditolak → catat jejak OFFER_REJECTED supaya user punya riwayatnya.
      try {
        await this.users.markTransferInstructionSettled(
          cid,
          'REJECTED',
          result.updateId ?? undefined,
        );
      } catch (err) {
        this.logger.warn(
          `markTransferInstructionSettled REJECTED (legacy) failed: ${String(err)}`,
        );
      }
      // ── PENERIMA selalu dapat history OFFER_REJECTED saat reject (Fix UX) ──
      // Sebelumnya: recordTransaction OFFER_REJECTED hanya jalan kalau
      // settledOwnReward === 0. Tapi markTransferInstructionSettled match row
      // PENDING global (milik SENDER) → return >0 → blok di-skip → PENERIMA
      // tidak dapat history reject. Cegah double via unique constraint
      // @@unique([userId, ledgerTxId]), bukan via settledOwnReward.
      try {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc: 0, // reject tidak menggerakkan saldo receiver
          type: 'OFFER_REJECTED',
          description:
            `Rejected incoming transfer${senderLabel ? ` from ${senderLabel}` : ''}` +
            (amountCc > 0 ? ` (${amountCc} CC)` : ''),
          ledgerTxId: result.updateId ?? cid,
          cantonUpdateId: result.updateId ?? undefined,
          // Jumlah ASLI offer yang ditolak — disimpan untuk display "cancelled X CC".
          cancelledAmountCc: amountCc,
          // SILENT: row tetap di history, tapi tidak push notif duplikat
          // (sender sudah dapat notif dari markTransferInstructionSettled).
          silent: true,
        });
      } catch (err) {
        this.logger.warn(
          `Recipient OFFER_REJECTED on reject failed (cid=${cid.slice(0, 16)}…): ${String(err)}`,
        );
      }
      return {
        ok: true,
        updateId: result.updateId,
        message: 'Transfer offer rejected.',
      };
    }
  }
}
