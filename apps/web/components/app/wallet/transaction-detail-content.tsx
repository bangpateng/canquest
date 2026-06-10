"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils/utils";
import { CopyField } from "@/components/app/wallet/copy-field";
import { useTransactionDetail } from "@/lib/hooks/use-transaction-detail";

type DetailProps = { detail: any; loading: boolean; error: string | null; compact?: boolean; };

export function TransactionDetailContent({ detail, loading, error, compact }: DetailProps) {
  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>;
  if (error) return <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 text-center text-sm text-[var(--muted-foreground)]">{error}</div>;
  if (!detail) return null;

  return (
    <div className={cn("w-full min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]", compact ? "p-5" : "p-6")}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><p className="text-xs text-[var(--muted-foreground)]">Type</p><p className="text-sm font-semibold text-[var(--foreground)]">{detail.type || "\u2014"}</p></div>
          <div><p className="text-xs text-[var(--muted-foreground)]">Amount</p><p className="text-sm font-bold tabular-nums text-[var(--foreground)]">{detail.amountCC != null ? `${Number(detail.amountCC).toFixed(4)} CC` : "\u2014"}</p></div>
          <div className="col-span-2"><p className="text-xs text-[var(--muted-foreground)]">Description</p><p className="text-sm text-[var(--foreground)]">{detail.description || "\u2014"}</p></div>
          {detail.counterparty && <div><p className="text-xs text-[var(--muted-foreground)]">Counterparty</p><p className="text-sm font-mono text-[var(--foreground)] truncate">{detail.counterparty}</p></div>}
          <div><p className="text-xs text-[var(--muted-foreground)]">Date</p><p className="text-sm text-[var(--foreground)]">{detail.createdAt ? new Date(detail.createdAt).toLocaleString() : "\u2014"}</p></div>
        </div>
        {detail.ledgerTxId && (
          <div className={cn("w-full min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]", compact ? "p-5" : "p-6")}>
            <CopyField label="Ledger Transaction ID" value={detail.ledgerTxId} />
          </div>
        )}
      </div>
    </div>
  );
}