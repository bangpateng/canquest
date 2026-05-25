"use client";

import { CheckCircle2, X } from "lucide-react";

import { TransactionDetailContent } from "@/components/app/transaction-detail-content";
import { iconButtonClass } from "@/lib/ui-button-styles";
import { useTransactionDetail } from "@/lib/hooks/use-transaction-detail";

type TransactionDetailModalProps = {
  open: boolean;
  transactionId: string | null;
  title?: string;
  subtitle?: string;
  onClose: () => void;
};

/** Same explorer UI as /transactions/[id], in a dialog (e.g. after Send CC). */
export function TransactionDetailModal({
  open,
  transactionId,
  title = "Transfer sent",
  subtitle = "Your transaction is recorded. Details below.",
  onClose,
}: TransactionDetailModalProps) {
  const { detail, loading, error } = useTransactionDetail(open ? transactionId : null);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto overscroll-contain p-3 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 my-auto flex w-full min-w-0 max-h-[min(92vh,92dvh)] max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl sm:max-h-[min(90vh,90dvh)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-8 w-8 shrink-0 text-green-500" aria-hidden />
            <div className="min-w-0">
              <h2 className="type-section-title text-[var(--foreground)]">{title}</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("h-9 w-9 shrink-0 text-[var(--foreground)]")}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-4">
          <TransactionDetailContent
            detail={detail}
            loading={loading}
            error={error}
            compact
          />
        </div>
      </div>
    </div>
  );
}
