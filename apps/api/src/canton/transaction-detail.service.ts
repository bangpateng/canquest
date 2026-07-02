import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  /** Status row: COMPLETED | PENDING | REJECTED (offer pending → PENDING). */
  status?: string | null;
};

@Injectable()
export class TransactionDetailService {
  private readonly logger = new Logger(TransactionDetailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: CantonLedgerService,
    private readonly users: UsersService,
    private readonly modo: ModoApiService,
  ) {}

  /** Explorer link via Modo (cc.modo.link/mainnet/updates/{id}). */
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
          'On-chain detail unavailable (ledger unreachable or update not indexed yet).';
      }
    }

    const counterparty =
      tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT'
        ? await this.users.resolveTransferCounterparty(tx.referenceId)
        : null;

    // Platform fee (CC withdraw fee) yang dipotong saat transfer keluar ini.
    // Baris fee dicatat terpisah dengan referenceId "fee:..." dan disembunyikan
    // dari history list, tapi TETAP ditampilkan di modal detail. Di-link via
    // rentang waktu (fee selalu dibuat bersama transfer dalam satu request send-cc).
    let platformFeeMicroCc: string | null = null;
    if (tx.type === 'TRANSFER_OUT') {
      const feeRow = await this.findLinkedPlatformFee(tx.userId, tx.createdAt);
      if (feeRow) {
        platformFeeMicroCc = feeRow.amountMicroCc.toString();
      }
    }

    // Event/update id untuk link explorer Modo (cc.modo.link). Preferensi
    // ledgerTxId (biasanya = update_id transaksi, format "1220…") — itu yang
    // cocok untuk link explorer. cantonUpdateId bisa berupa contract id (format
    // beda) → jangan dipakai utama.
    const rawId = tx.ledgerTxId ?? cantonUpdateId ?? null;
    const eventId = await this.resolveExplorerId(
      user?.cantonPartyId ?? '',
      rawId,
    );

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
      cantonScanUrl: this.explorerUrl(eventId),
      onChainSettled: Boolean(tx.settledAt || cantonUpdateId),
      ledgerEvents,
      ledgerFetchError,
      platformFeeMicroCc,
      eventId,
      status: tx.status,
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
