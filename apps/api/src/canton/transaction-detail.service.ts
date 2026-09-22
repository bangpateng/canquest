import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CantonLedgerService } from './canton-ledger.service';
import { isPlatformFeeTransaction } from '../users/cc-transaction-visibility';

export type LedgerEventSummary = {
  kind: 'created' | 'archived';
  contractId: string;
  templateId: string;
};

/**
 * Detail offer yang MASIH hidup di ACS ledger (belum di-accept/reject/withdraw).
 *
 * Dipakai UI untuk membedakan "janji" (offer pending — belum ada perpindahan
 * dana final, jadi bukan TX) dari "fakta" (TX final setelah accept). Sumbernya
 * ACS on-chain lewat queryPendingOffers, bukan tabel history — jadi baris DB
 * yang statusnya PENDING tapi offer-nya sudah dikonsumsi akan tampil sebagai
 * TX biasa (self-healing terhadap drift DB ↔ ledger).
 *
 * Instrument-agnostic: CC (Amulet) maupun token registry (USDCx, CBTC, …)
 * memakai bentuk yang sama.
 */
export type PendingOfferInfo = {
  contractId: string;
  type: 'transfer_offer' | 'transfer_instruction';
  sender: string;
  receiver: string;
  amount: string;
  description: string;
  /** Batas waktu penerima boleh accept (executeBefore) — ISO string. */
  expiresAt: string;
  createdAt: string;
  instrumentId: string;
  instrumentAdmin: string;
};

export type TransactionDetailResponse = {
  id: string;
  type: string;
  amountMicroCc: string;
  description: string;
  referenceId: string | null;
  counterparty: string | null;
  ledgerContractId: string | null;
  cantonUpdateId: string | null;
  settledAt: string | null;
  createdAt: string;
  cantonPartyId: string | null;
  cantonScanUrl: string | null;
  onChainSettled: boolean;
  ledgerEvents: LedgerEventSummary[];
  ledgerFetchError: string | null;
  /** Platform fee (CC withdraw fee) dipotong saat transfer — 0/null jika tidak ada.
   *  Tampil di modal detail; baris fee tetap disembunyikan dari history list. */
  platformFeeMicroCc?: string | null;
  /** Modo explorer event/update id — dipakai untuk link explorer cc.modo.link.
   *  = cantonUpdateId bila tersedia, fallback ledgerContractId. */
  eventId?: string | null;
  /** True bila tx id adalah marker internal (fee/inbound-sync/unlock/preapproval:disable/
   *  reward-) — BUKAN transaksi on-chain real. Frontend sembunyikan link explorer untuk
   *  row ini dan tampilkan tx id sebagai teks biasa (tidak menyesatkan user). */
  isInternalMarker?: boolean;
  /** Status row: COMPLETED | PENDING | REJECTED (offer pending → PENDING). */
  status?: string | null;
  /** Instrument id untuk token non-CC (mis. "USDCx"). null untuk CC murni. */
  instrumentId?: string | null;
  /** Amount token dalam unit asli (Decimal string). null untuk CC. */
  amountDecimal?: string | null;
  /** Jumlah CC asli yang dibatalkan/ditolak (OFFER_WITHDRAWN / OFFER_REJECTED). */
  cancelledAmountCc?: string | null;
  /** Jumlah token asli yang dibatalkan (TOKEN_OFFER_WITHDRAWN / REJECTED). */
  cancelledAmount?: string | null;
  /** Instrument id token yang dibatalkan (mis. "USDCx"). */
  cancelledInstrumentId?: string | null;
  /** Terisi HANYA bila baris masih PENDING dan offer-nya masih hidup di ACS
   *  ledger. Kehadirannya = UI harus render detail offer (bukan receipt TX),
   *  karena belum ada perpindahan dana final. null = TX final / non-offer. */
  offer?: PendingOfferInfo | null;
  /** Peran user pada offer pending: pengirim (bisa Withdraw) atau penerima
   *  (bisa Accept/Reject). null bila offer tidak ada / party tidak cocok. */
  offerRole?: 'sender' | 'receiver' | null;
};

/**
 * Deteksi apakah sebuah tx id adalah "marker internal" (bukan transaksi on-chain real).
 * Marker: namespace prefix tanpa "::", atau prefix eksplisit (fee/inbound-sync/unlock/
 * preapproval:disable/reward-/claim/manual/placeholder). Update id asli ("1220…") dan
 * contract id Canton ("00…") BUKAN marker.
 */
function isInternalTxMarker(id: string | null | undefined): boolean {
  if (!id) return false;
  const v = id.trim();
  if (!v) return false;
  if (v.startsWith('1220')) return false;
  if (v.startsWith('00') && /^[0-9a-f]+$/.test(v)) return false; // Canton contract id
  if (/^[a-z][a-z0-9-]*:/i.test(v) && !v.includes('::')) return true;
  if (
    /^(inbound-sync|fee|unlock|preapproval:disable|preapproval|reward-|claim|manual|placeholder)/i.test(
      v,
    )
  )
    return true;
  return false;
}

@Injectable()
export class TransactionDetailService {
  private readonly logger = new Logger(TransactionDetailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CantonLedgerService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Build link explorer untuk sebuah update id.
   * Default: CantonScan (`https://www.cantonscan.com/update/{id}`) — path
   * `/update/` untuk updateId (FIX 2026-09-07: path lama `/tx/` membuka halaman
   * transaksi yang salah/kosong). Explorer full-Daml yang men-decode SEMUA
   * template (termasuk USDCx/Utility Holding), bukan hanya Amulet seperti
   * ccview.io/cc.modo.link (link lama membuat tx USDCx tampil sebagai
   * pergerakan CC — keluhan owner 2026-09-04).
   * Override via env CANTON_TX_EXPLORER_URL (placeholder {id}).
   * Pure string formatting — tidak ada network call. Null untuk input kosong.
   */
  explorerUrl(eventId: string | null | undefined): string | null {
    if (!eventId?.trim()) return null;
    // Strip suffix turunan ledgerTxId: ":N" numerik (event_id) MAUPUN
    // ":<instrument>" huruf (mis. "<updateId>:usdcx" dari baris token
    // multi-instrumen L60 — updateId asli = bagian sebelum ":").
    const id = eventId
      .trim()
      .replace(/:[0-9]+$/, '')
      .replace(/^(1220[0-9a-f]+):[A-Za-z][A-Za-z0-9_-]*$/, '$1');
    const template =
      this.config.get<string>('CANTON_TX_EXPLORER_URL')?.trim() ||
      'https://www.cantonscan.com/update/{id}';
    return template.replace('{id}', encodeURIComponent(id));
  }

  /**
   * Resolve explorer update_id ("1220…") dari update_id / event_id / contract id.
   *
   * Strategy (pure string logic, optional Canton ledger fallback):
   *   1. Empty / internal marker (fee:, claim:, namespace: tan "::") → null.
   *   2. Starts with "1220" → sudah update id, return apa adanya.
   *   3. Trailing ":N" (event_id) → strip suffix.
   *   4. Contract id panjang (>16 chars) → resolve via Canton ledger
   *      (findUpdateIdForContract) — pengganti Modo /contracts API yang
   *      sudah dihapus.
   *   5. Otherwise null.
   *
   * Non-fatal: input kosong / marker internal → null (link explorer tidak
   * tampil, tapi data transaksi tetap muncul).
   */
  async resolveExplorerId(
    partyId: string,
    updateIdOrContractId: string | null | undefined,
  ): Promise<string | null> {
    const id = updateIdOrContractId?.trim();
    if (!id) return null;
    if (this.isInternalMarker(id)) return null;
    if (id.startsWith('1220')) {
      // UpdateId ber-suffix instrumen L60 ("<updateId>:usdcx") → kembalikan
      // updateId asli (bagian hex) supaya link explorer valid.
      const m = id.match(/^(1220[0-9a-f]+):[A-Za-z][A-Za-z0-9_-]*$/);
      return m ? m[1] : id;
    }
    if (/:[0-9]+$/.test(id)) return id.replace(/:[0-9]+$/, '');
    // Contract id panjang → resolve creatingUpdate via Canton ledger langsung.
    if (id.length > 16 && partyId) {
      const updateId = await this.ledger.findUpdateIdForContract(id, partyId);
      return updateId && updateId.startsWith('1220') ? updateId : null;
    }
    return null;
  }

  /** Reject placeholder / internal markers yang tidak resolve ke update real. */
  private isInternalMarker(id: string): boolean {
    if (id.startsWith('1220')) return false;
    if (/^[a-z][a-z0-9-]*:/i.test(id) && !id.includes('::')) return true;
    if (/^(inbound-sync|fee|claim|manual|placeholder):/i.test(id)) return true;
    return false;
  }

  /**
   * Pilih id ledger paling representatif dari sepasang kolom history.
   *
   * `cantonUpdateId` DIUTAMAKAN karena di-flip saat settle: setelah offer
   * di-accept, markTransferInstructionSettled menstamp kolom itu dengan update
   * ACCEPT, sementara `ledgerTxId` tetap menyimpan update CREATE-OFFER (kapan
   * offer dibuat, saat itu statusnya masih pending). Memakai ledgerTxId lebih
   * dulu membuat baris "Send" yang sudah settle terus menunjuk tx offer lama —
   * di explorer tampil sebagai TransferPendingReceiverAcceptance selamanya.
   *
   * Fallback ke ledgerTxId bila cantonUpdateId kosong, supaya row lama
   * (pra-backfill) tetap punya identitas. Id sintetis ("swap:…",
   * "inbound-sync:…") ditolak oleh resolveExplorerId di hilir — jadi aman
   * dikembalikan apa adanya di sini.
   */
  private pickLedgerId(
    ledgerTxId: string | null | undefined,
    cantonUpdateId: string | null | undefined,
  ): string | null {
    const update = cantonUpdateId?.trim();
    const ledger = ledgerTxId?.trim();
    return update || ledger || null;
  }

  /**
   * Lampirkan detail offer yang MASIH hidup di ACS ledger untuk baris PENDING.
   *
   * Sengaja menanyakan ledger, bukan mempercayai kolom status DB: kalau offer
   * sudah dikonsumsi (baris DB telat ter-flip), lookup gagal → `offer: null`,
   * sehingga UI merender TX biasa alih-alih "pending selamanya". Ini juga yang
   * membuat perilaku seragam lintas instrumen (CC/Amulet maupun token registry)
   * — queryPendingOffers sudah instrument-aware.
   *
   * Non-fatal: kegagalan ledger tidak boleh menggagalkan pembukaan detail.
   */
  private async attachPendingOffer(params: {
    status: string | null | undefined;
    transferInstructionCid: string | null | undefined;
    partyId: string | null | undefined;
  }): Promise<{
    offer: PendingOfferInfo | null;
    offerRole: 'sender' | 'receiver' | null;
  }> {
    const { status, transferInstructionCid, partyId } = params;
    if (status !== 'PENDING' || !transferInstructionCid || !partyId) {
      return { offer: null, offerRole: null };
    }
    try {
      const found = await this.ledger.lookupOfferDetailBothDirections(
        transferInstructionCid,
        partyId,
      );
      if (!found) return { offer: null, offerRole: null };
      const offer: PendingOfferInfo = {
        contractId: found.contractId,
        type: found.type,
        sender: found.sender,
        receiver: found.receiver,
        amount: found.amount,
        description: found.description,
        expiresAt: found.expiresAt ?? '',
        createdAt: found.createdAt ?? '',
        instrumentId: found.instrumentId,
        instrumentAdmin: found.instrumentAdmin,
      };
      return {
        offer,
        offerRole: this.resolveOfferRole(found.sender, found.receiver, partyId),
      };
    } catch (err) {
      this.logger.warn(
        `attachPendingOffer failed cid=${transferInstructionCid.slice(0, 16)}...: ${String(err)}`,
      );
      return { offer: null, offerRole: null };
    }
  }

  /** Peran user pada offer: pengirim atau penerima (case-insensitive party id). */
  private resolveOfferRole(
    sender: string,
    receiver: string,
    partyId: string,
  ): 'sender' | 'receiver' | null {
    const own = partyId.trim().toLowerCase();
    if (sender.trim().toLowerCase() === own) return 'sender';
    if (receiver.trim().toLowerCase() === own) return 'receiver';
    return null;
  }

  /** Resolve ledger updateId for a contract and persist on CcTransaction. */
  async backfillUpdateId(
    ccTransactionId: string,
    contractId: string,
    partyId: string,
  ): Promise<void> {
    if (!contractId || !partyId) return;
    try {
      const updateId = await this.ledger.findUpdateIdForContract(
        contractId,
        partyId,
      );
      if (!updateId) return;
      await this.prisma.ccTransaction.updateMany({
        where: { id: ccTransactionId, cantonUpdateId: null },
        data: { cantonUpdateId: updateId, settledAt: new Date() },
      });
    } catch (err) {
      this.logger.debug(`backfillUpdateId ${ccTransactionId}: ${String(err)}`);
    }
  }

  async getDetailForUser(
    userId: string,
    transactionId: string,
  ): Promise<TransactionDetailResponse> {
    // Unified Activity feed meng-prefix id: "cc-" (CcTransaction) atau "tok-"
    // (TokenTransaction) untuk mencegah collision cuid antar dua tabel. Lama
    // (tanpa prefix) → backward-compat, anggap CC.
    const raw = transactionId.trim();
    if (raw.startsWith('tok-')) {
      return this.getTokenDetailForUser(userId, raw.slice(4));
    }
    const ccId = raw.startsWith('cc-') ? raw.slice(3) : raw;
    return this.getCcDetailForUser(userId, ccId);
  }

  /** Detail untuk transaksi token non-CC (TokenTransaction). */
  private async getTokenDetailForUser(
    userId: string,
    tokenTransactionId: string,
  ): Promise<TransactionDetailResponse> {
    const [tx, user] = await Promise.all([
      this.prisma.tokenTransaction.findFirst({
        where: { id: tokenTransactionId, userId },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { cantonPartyId: true },
      }),
    ]);

    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }

    const cantonUpdateId = tx.cantonUpdateId;
    const ledgerEvents: LedgerEventSummary[] = [];
    const ledgerFetchError: string | null = null;

    // Panel "On-chain events" dihapus dari UI (keputusan owner 2026-09-13);
    // field respons dipertahankan (kosong) demi kompatibilitas kontrak API.
    void cantonUpdateId;
    void user?.cantonPartyId;

    // Event/update id untuk link explorer Modo. Preferensi: cantonUpdateId
    // (di-stamp saat settle = update ACCEPT) sebelum ledgerTxId (update
    // create-offer) — lihat pickLedgerId.
    const rawId = this.pickLedgerId(tx.ledgerTxId, cantonUpdateId);
    const internalMarker = isInternalTxMarker(rawId);
    const eventId = internalMarker
      ? null
      : await this.resolveExplorerId(user?.cantonPartyId ?? '', rawId);

    // Counterparty baris token: resolve seperti jalur CC supaya party lawan
    // (peer transfer / escrow swap) tampil ternormalisasi, bukan id mentah.
    // QUEST_REWARD token: pengirim = reward wallet / validator (dari quest).
    const tokenCounterparty =
      tx.type === 'TOKEN_TRANSFER_IN' ||
      tx.type === 'TOKEN_TRANSFER_OUT' ||
      tx.type === 'SWAP_IN' ||
      tx.type === 'SWAP_OUT'
        ? await this.users.resolveTransferCounterparty(tx.referenceId)
        : tx.type === 'QUEST_REWARD'
          ? await this.users.resolveQuestRewardSender(tx.referenceId)
          : tx.referenceId;

    // Offer pending → detail ledger khusus (bukan receipt TX). null = TX final.
    const { offer, offerRole } = await this.attachPendingOffer({
      status: tx.status,
      transferInstructionCid: tx.transferInstructionCid,
      partyId: user?.cantonPartyId,
    });
    // Fee platform untuk token: baris fee ditulis di CcTransaction (fee selalu
    // CC, nominal sama dengan leg Amulet di batch yang sama). Hanya relevan
    // bagi pengirim — penerima tidak membayar apa pun.
    const platformFeeMicroCc =
      offerRole === 'sender'
        ? ((
            await this.findLinkedPlatformFee(tx.userId, tx.createdAt)
          )?.amountMicroCc.toString() ?? null)
        : null;

    return {
      id: `tok-${tx.id}`,
      type: tx.type,
      // CC placeholder (backward-compat field lama). Token pakai amountDecimal.
      amountMicroCc: '0',
      description: tx.description ?? '',
      referenceId: tx.referenceId,
      counterparty: tokenCounterparty,
      ledgerContractId: tx.ledgerTxId,
      cantonUpdateId,
      settledAt: null,
      createdAt: tx.createdAt.toISOString(),
      cantonPartyId: user?.cantonPartyId ?? null,
      cantonScanUrl: internalMarker ? null : this.explorerUrl(eventId),
      onChainSettled: Boolean(cantonUpdateId),
      ledgerEvents,
      ledgerFetchError,
      eventId,
      isInternalMarker: internalMarker,
      status: tx.status,
      // Token-aware fields.
      instrumentId: tx.instrumentId,
      amountDecimal: tx.amount.toString(),
      // Cancelled-amount (TOKEN_OFFER_WITHDRAWN / REJECTED).
      cancelledAmount: tx.cancelledAmount
        ? tx.cancelledAmount.toString()
        : null,
      cancelledInstrumentId: tx.instrumentId,
      platformFeeMicroCc,
      offer,
      offerRole,
    };
  }

  /** Detail untuk transaksi CC (CcTransaction) — path asli. */
  private async getCcDetailForUser(
    userId: string,
    ccTransactionId: string,
  ): Promise<TransactionDetailResponse> {
    const [tx, user] = await Promise.all([
      this.prisma.ccTransaction.findFirst({
        where: { id: ccTransactionId, userId },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { cantonPartyId: true },
      }),
    ]);

    if (!tx || isPlatformFeeTransaction(tx.description)) {
      throw new NotFoundException('Transaction not found');
    }

    let cantonUpdateId = tx.cantonUpdateId;
    // Lazy-fill updateId dari contract id HANYA bila ledgerTxId memang contract
    // id. Baris offer (dan sebagian transfer) menyimpan updateId asli di
    // ledgerTxId — me-resolve-nya sebagai contract akan menghasilkan lookup
    // sia-sia / nilai salah lalu menimpa cantonUpdateId yang sudah benar.
    const ledgerLooksLikeUpdateId = tx.ledgerTxId?.trim().startsWith('1220');
    if (
      !cantonUpdateId &&
      tx.ledgerTxId &&
      !ledgerLooksLikeUpdateId &&
      user?.cantonPartyId
    ) {
      cantonUpdateId = await this.ledger.findUpdateIdForContract(
        tx.ledgerTxId,
        user.cantonPartyId,
      );
      if (cantonUpdateId) {
        await this.prisma.ccTransaction.update({
          where: { id: tx.id },
          data: { cantonUpdateId, settledAt: tx.settledAt ?? new Date() },
        });
      }
    }

    const ledgerEvents: LedgerEventSummary[] = [];
    const ledgerFetchError: string | null = null;

    // Panel "On-chain events" dihapus dari UI (keputusan owner 2026-09-13);
    // field respons dipertahankan (kosong) demi kompatibilitas kontrak API.
    void cantonUpdateId;
    void user?.cantonPartyId;

    // Counterparty untuk baris pergerakan (transfer ATAU kaki swap): referenceId
    // menyimpan party lawan (escrow OneSwap untuk swap, party peer untuk transfer).
    // QUEST_REWARD: pengirim = reward wallet (campaign) / validator (auto-send) —
    // di-resolve dari quest-nya supaya modal menampilkan From yang benar.
    const counterparty =
      tx.type === 'TRANSFER_IN' ||
      tx.type === 'TRANSFER_OUT' ||
      tx.type === 'SWAP_IN' ||
      tx.type === 'SWAP_OUT'
        ? await this.users.resolveTransferCounterparty(tx.referenceId)
        : tx.type === 'QUEST_REWARD'
          ? await this.users.resolveQuestRewardSender(tx.referenceId)
          : null;

    // Offer pending → detail ledger khusus (bukan receipt TX). null = TX final.
    const { offer, offerRole } = await this.attachPendingOffer({
      status: tx.status,
      transferInstructionCid: tx.transferInstructionCid,
      partyId: user?.cantonPartyId,
    });

    // Platform fee — ditampilkan di modal detail. Sumber nilai:
    //   1. Transfer (TRANSFER_OUT): cari fee row terkait via findLinkedPlatformFee.
    //      Kalau tidak ketemu, fallback ke env TRANSACTION_FEE_CC.
    //   2. Lainnya (termasuk Swap): null. Swap OneSwap tidak punya platform fee
    //      dapp terpisah — fee OneSwap native (networkFeeIn/platformFee/lpFee)
    //      sudah terbungkus di amount, tidak ditampilkan sebagai platform fee.
    // Saat offer masih PENDING, fee hanya relevan bagi pengirim: penerima tidak
    // membayar apa pun, dan menampilkan nominal di sisi penerima menyesatkan.
    let platformFeeMicroCc: string | null = null;
    if (tx.type === 'TRANSFER_OUT' && offerRole !== 'receiver') {
      const feeRow = await this.findLinkedPlatformFee(tx.userId, tx.createdAt);
      if (feeRow) {
        platformFeeMicroCc = feeRow.amountMicroCc.toString();
      } else if (!offer) {
        // Fallback: env default (mis. 5 CC). Hanya untuk TX final — pada offer
        // pending baris fee sudah pasti tertulis bersamaan (satu batch), jadi
        // ketidakhadirannya berarti data belum sinkron, bukan estimasi.
        const feeCc = Number(
          this.config.get<string>('TRANSACTION_FEE_CC') ?? '0',
        );
        if (feeCc > 0) {
          platformFeeMicroCc = String(Math.round(feeCc * 1_000_000));
        }
      }
    }

    // Event/update id untuk link explorer. Preferensi cantonUpdateId (di-stamp
    // saat settle = update ACCEPT) sebelum ledgerTxId (update create-offer) —
    // lihat pickLedgerId.
    const rawId = this.pickLedgerId(tx.ledgerTxId, cantonUpdateId);
    const internalMarker = isInternalTxMarker(rawId);
    // Marker internal (fee/inbound-sync/unlock/preapproval:disable/reward-) TIDAK
    // di-resolve ke link explorer (bukan on-chain tx real) → eventId null.
    const eventId = internalMarker
      ? null
      : await this.resolveExplorerId(user?.cantonPartyId ?? '', rawId);

    return {
      id: tx.id,
      type: tx.type,
      amountMicroCc: tx.amountMicroCc.toString(),
      description: tx.description,
      referenceId: tx.referenceId,
      counterparty,
      ledgerContractId: tx.ledgerTxId,
      cantonUpdateId,
      settledAt: tx.settledAt?.toISOString() ?? null,
      createdAt: tx.createdAt.toISOString(),
      cantonPartyId: user?.cantonPartyId ?? null,
      cantonScanUrl: internalMarker ? null : this.explorerUrl(eventId),
      onChainSettled: Boolean(tx.settledAt || cantonUpdateId),
      ledgerEvents,
      ledgerFetchError,
      platformFeeMicroCc,
      eventId,
      isInternalMarker: internalMarker,
      status: tx.status,
      // Cancelled-amount (OFFER_WITHDRAWN / OFFER_REJECTED).
      cancelledAmountCc: tx.cancelledAmountCc
        ? tx.cancelledAmountCc.toString()
        : null,
      cancelledInstrumentId: tx.cancelledInstrumentId,
      offer,
      offerRole,
    };
  }

  /**
   * Cari baris platform fee yang terkait dengan sebuah transfer keluar.
   * Fee row: type=TRANSFER_OUT, referenceId mulai "fee:", dibuat ±60 detik
   * dari transfer utama (fee selalu dibuat bersamaan dalam satu request send-cc).
   */
  private async findLinkedPlatformFee(
    userId: string,
    transferCreatedAt: Date,
  ): Promise<{ amountMicroCc: bigint } | null> {
    try {
      const since = new Date(transferCreatedAt.getTime() - 60_000);
      const until = new Date(transferCreatedAt.getTime() + 60_000);
      const row = await this.prisma.ccTransaction.findFirst({
        where: {
          userId,
          type: 'TRANSFER_OUT',
          referenceId: { startsWith: 'fee:' },
          createdAt: { gte: since, lte: until },
        },
        select: { amountMicroCc: true },
        orderBy: { createdAt: 'asc' },
      });
      return row ?? null;
    } catch (err) {
      this.logger.debug(`findLinkedPlatformFee: ${String(err)}`);
      return null;
    }
  }
}
