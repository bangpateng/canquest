import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  CantonLedgerService,
  type LedgerStreamEvent,
} from './canton-ledger.service';
import { isPlatformFeeTransaction } from '../users/cc-transaction-visibility';
import { ModoApiService } from './modo-api.service';

export type LedgerEventSummary = {
  kind: 'created' | 'archived';
  contractId: string;
  templateId: string;
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
    private readonly modo: ModoApiService,
    private readonly config: ConfigService,
  ) {}

  /** Explorer link via Modo (cc.modo.link/mainnet/event/{id}:0). */
  explorerUrl(eventId: string | null | undefined): string | null {
    return this.modo.explorerUrl(eventId);
  }

  /**
   * Resolve explorer update_id dari Canton update_id / contract id / event_id.
   * Delegated to ModoApiService (pure string parsing + optional /contracts
   * fallback).
   *
   * Non-fatal: input kosong / marker internal → null (link explorer tidak
   * tampil, tapi data transaksi tetap muncul).
   */
  resolveExplorerId(
    partyId: string,
    updateIdOrContractId: string | null | undefined,
  ): Promise<string | null> {
    return this.modo.resolveEventId(partyId, updateIdOrContractId);
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
    let ledgerEvents: LedgerEventSummary[] = [];
    let ledgerFetchError: string | null = null;

    if (cantonUpdateId && user?.cantonPartyId) {
      const onChain = await this.ledger.fetchTransactionByUpdateId(
        cantonUpdateId,
        user.cantonPartyId,
      );
      if (onChain) {
        ledgerEvents = summarizeLedgerEvents(onChain.events);
      } else {
        ledgerFetchError = '';
      }
    }

    // Event/update id untuk link explorer Modo.
    const rawId = tx.ledgerTxId ?? cantonUpdateId ?? null;
    const internalMarker = isInternalTxMarker(rawId);
    const eventId = internalMarker
      ? null
      : await this.resolveExplorerId(user?.cantonPartyId ?? '', rawId);

    return {
      id: `tok-${tx.id}`,
      type: tx.type,
      // CC placeholder (backward-compat field lama). Token pakai amountDecimal.
      amountMicroCc: '0',
      description: tx.description ?? '',
      referenceId: tx.referenceId,
      counterparty: tx.referenceId,
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
    if (!cantonUpdateId && tx.ledgerTxId && user?.cantonPartyId) {
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

    let ledgerEvents: LedgerEventSummary[] = [];
    let ledgerFetchError: string | null = null;

    if (cantonUpdateId && user?.cantonPartyId) {
      const onChain = await this.ledger.fetchTransactionByUpdateId(
        cantonUpdateId,
        user.cantonPartyId,
      );
      if (onChain) {
        ledgerEvents = summarizeLedgerEvents(onChain.events);
      } else {
        ledgerFetchError =
          '';
      }
    }

    const counterparty =
      tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT'
        ? await this.users.resolveTransferCounterparty(tx.referenceId)
        : null;

    // Platform fee — ditampilkan di modal detail. Sumber nilai:
    //   1. Transfer (TRANSFER_OUT): cari fee row terkait via findLinkedPlatformFee.
    //      Kalau tidak ketemu, fallback ke env TRANSACTION_FEE_CC.
    //   2. Swap (SWAP_OUT/SWAP_IN): swap tidak catat fee row ke CcTransaction,
    //      jadi pakai env SWAP_PLATFORM_FEE_CC langsung.
    //   3. Lainnya: null (tidak ada platform fee).
    let platformFeeMicroCc: string | null = null;
    if (tx.type === 'TRANSFER_OUT') {
      const feeRow = await this.findLinkedPlatformFee(tx.userId, tx.createdAt);
      if (feeRow) {
        platformFeeMicroCc = feeRow.amountMicroCc.toString();
      } else {
        // Fallback: env default (mis. 5 CC).
        const feeCc = Number(
          this.config.get<string>('TRANSACTION_FEE_CC') ?? '0',
        );
        if (feeCc > 0) {
          platformFeeMicroCc = String(Math.round(feeCc * 1_000_000));
        }
      }
    } else if (tx.type === 'SWAP_OUT' || tx.type === 'SWAP_IN') {
      const swapFeeCc = Number(
        this.config.get<string>('SWAP_PLATFORM_FEE_CC') ?? '0',
      );
      if (swapFeeCc > 0) {
        platformFeeMicroCc = String(Math.round(swapFeeCc * 1_000_000));
      }
    }

    // Event/update id untuk link explorer Modo (cc.modo.link). Preferensi
    // ledgerTxId (biasanya = update_id transaksi, format "1220…") — itu yang
    // cocok untuk link explorer. cantonUpdateId bisa berupa contract id (format
    // beda) → jangan dipakai utama.
    const rawId = tx.ledgerTxId ?? cantonUpdateId ?? null;
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

function summarizeLedgerEvents(
  events: LedgerStreamEvent[],
): LedgerEventSummary[] {
  const out: LedgerEventSummary[] = [];
  for (const event of events) {
    if (event.created?.contractId) {
      out.push({
        kind: 'created',
        contractId: event.created.contractId,
        templateId: event.created.templateId,
      });
    }
    if (event.archived?.contractId) {
      out.push({
        kind: 'archived',
        contractId: event.archived.contractId,
        templateId: event.archived.templateId,
      });
    }
  }
  return out;
}
