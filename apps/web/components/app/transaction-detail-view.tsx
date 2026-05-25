"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { TransactionDetailContent } from "@/components/app/transaction-detail-content";
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
};

type TransactionDetailViewProps = {
  transactionId: string;
};

export function TransactionDetailView({ transactionId }: TransactionDetailViewProps) {
  const { detail, loading, error } = useTransactionDetail(transactionId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/transactions"
        className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to transactions
      </Link>

      <TransactionDetailContent detail={detail} loading={loading} error={error} />
    </div>
  );
}
