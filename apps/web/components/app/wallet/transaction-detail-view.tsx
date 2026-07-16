"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { TransactionDetailContent } from "@/components/app/wallet/transaction-detail-content";
import { useTransactionDetail } from "@/lib/hooks/use-transaction-detail";

export type TransactionDetail = {
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
  ledgerEvents: Array<{
    kind: "created" | "archived";
    contractId: string;
    templateId: string;
  }>;
  ledgerFetchError: string | null;
  /** Optional on-chain extras (present for on-chain items). */
  networkFeeMicroCc?: string | null;
  /** Platform fee (CC withdraw fee) dipotong saat transfer — tampil di modal. */
  platformFeeMicroCc?: string | null;
  /** Canton round number the transaction settled in. */
  round?: number | string | null;
  /** Estimated USD value of the amount, if known. */
  usdEstimate?: number | null;
  /** Real sender address (on-chain transfers). */
  senderAddress?: string | null;
  /** Real receiver address (on-chain transfers). */
  receiverAddress?: string | null;
  /** Explorer event/update id — used for the explorer link. */
  eventId?: string | null;
  /** True bila tx id adalah marker internal (fee/inbound-sync/unlock/preapproval/
   *  reward-) — BUKAN transaksi on-chain real. Link explorer disembunyikan. */
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



type TransactionDetailViewProps = {
  transactionId: string;
};

export function TransactionDetailView({ transactionId }: TransactionDetailViewProps) {
  const { detail, loading, error } = useTransactionDetail(transactionId);

  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-6 sm:space-y-8">
      <Link
        href="/activity"
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100"
      >
        <ArrowLeft className="h-5 w-5" />
        Back to activity
      </Link>

      <TransactionDetailContent detail={detail} loading={loading} error={error} />
    </div>
  );
}
