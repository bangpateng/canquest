import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CantonLedgerService, type LedgerStreamEvent } from './canton-ledger.service';
import { isPlatformFeeTransaction } from '../users/cc-transaction-visibility';

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
};

@Injectable()
export class TransactionDetailService {
  private readonly logger = new Logger(TransactionDetailService.name);
  private readonly scanTxUrlTemplate: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ledger: CantonLedgerService,
  ) {
    this.scanTxUrlTemplate =
      config.get<string>('CANTON_SCAN_TX_URL')?.trim() ||
      'https://www.cantonscan.com/tx/{updateId}';
  }

  cantonScanUrl(updateId: string | null | undefined): string | null {
    if (!updateId?.trim()) return null;
    if (this.scanTxUrlTemplate.includes('{updateId}')) {
      return this.scanTxUrlTemplate.replace('{updateId}', encodeURIComponent(updateId));
    }
    return `${this.scanTxUrlTemplate.replace(/\/$/, '')}/${encodeURIComponent(updateId)}`;
  }

  /** Resolve ledger updateId for a contract and persist on CcTransaction. */
  async backfillUpdateId(
    ccTransactionId: string,
    contractId: string,
    partyId: string,
  ): Promise<void> {
    if (!contractId || !partyId) return;
    try {
      const updateId = await this.ledger.findUpdateIdForContract(contractId, partyId);
      if (!updateId) return;
      await this.prisma.ccTransaction.updateMany({
        where: { id: ccTransactionId, cantonUpdateId: null },
        data: { cantonUpdateId: updateId, settledAt: new Date() },
      });
    } catch (err) {
      this.logger.debug(`backfillUpdateId ${ccTransactionId}: ${String(err)}`);
    }
  }

  async getDetailForUser(userId: string, ccTransactionId: string): Promise<TransactionDetailResponse> {
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
        ? tx.referenceId
        : null;

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
      cantonScanUrl: this.cantonScanUrl(cantonUpdateId),
      onChainSettled: Boolean(tx.settledAt || cantonUpdateId),
      ledgerEvents,
      ledgerFetchError,
    };
  }
}

function summarizeLedgerEvents(events: LedgerStreamEvent[]): LedgerEventSummary[] {
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
