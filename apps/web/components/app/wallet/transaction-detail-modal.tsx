"use client";
import { CheckCircle2, X } from "lucide-react";
import { TransactionDetailContent } from "@/components/app/wallet/transaction-detail-content";
import { useTransactionDetail } from "@/lib/hooks/use-transaction-detail";

type TransactionDetailModalProps = { open: boolean; transactionId: string | null; title?: string; subtitle?: string; onClose: () => void; };
export function TransactionDetailModal({ open, transactionId, title = "Transfer sent", subtitle = "Details below.", onClose }: TransactionDetailModalProps) {
  const { detail, loading, error } = useTransactionDetail(open ? transactionId : null);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center sm:p-6" role="presentation">
      <button type="button" className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-md max-h-[92vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-7 w-7 shrink-0 text-emerald-500" />
            <div><h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2><p className="text-xs text-[var(--muted-foreground)]">{subtitle}</p></div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-[var(--muted)]"><X className="h-4 w-4 text-[var(--muted-foreground)]" /></button>
        </div>
        <TransactionDetailContent detail={detail} loading={loading} error={error} compact />
      </div>
    </div>
  );
}