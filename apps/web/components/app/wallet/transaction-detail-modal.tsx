"use client";

import { ArrowDownLeft, ArrowUpRight, CheckCircle2, X } from "lucide-react";

import { TransactionDetailContent } from "@/components/app/wallet/transaction-detail-content";
import type { TransactionDetail } from "@/components/app/wallet/transaction-detail-view";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { useTransactionDetail } from "@/lib/hooks/use-transaction-detail";

type TransactionDetailModalProps = {
  open: boolean;
  transactionId: string | null;
  title?: string;
  subtitle?: string;
  /** Caller's Canton party ID — used to decide which address is "You" and IN vs OUT. */
  partyId?: string | null;
  onClose: () => void;
};

/** Same explorer UI as /transactions/[id], in a dialog (e.g. after Send CC).
 *  Detail selalu di-fetch dari DB by transactionId (list is DB-only). */
export function TransactionDetailModal({
  open,
  transactionId,
  title,
  subtitle,
  partyId = null,
  onClose,
}: TransactionDetailModalProps) {
  const { detail, loading, error } = useTransactionDetail(
    open ? transactionId : null,
  );

  if (!open) return null;

  // Decide direction from the detail. Defaults to "sent" until detail loads
  // (most modal openers are post-send), but flips to "received" for TRANSFER_IN / TOKEN_TRANSFER_IN.
  const isIn =
    detail?.type === "TRANSFER_IN" ||
    detail?.type === "TOKEN_TRANSFER_IN";

  const headerTitle = title ?? (isIn ? "Transfer received" : "Transfer sent");
  const headerSubtitle = subtitle ?? "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto overscroll-contain p-4 sm:items-center sm:p-6"
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
        className="relative z-10 my-auto flex w-full min-w-0 max-h-[min(92vh,92dvh)] max-w-md flex-col overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)] shadow-xl sm:max-h-[min(90vh,90dvh)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 px-6 py-5">
          <div className="flex min-w-0 items-start gap-4">
            {loading ? (
              <CheckCircle2 className="mt-1 h-10 w-10 shrink-0 text-slate-500" aria-hidden />
            ) : (
              <span
                className={cn(
                  "mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                  isIn ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500",
                )}
                aria-hidden
              >
                {isIn ? (
                  <ArrowDownLeft className="h-5 w-5" />
                ) : (
                  <ArrowUpRight className="h-5 w-5" />
                )}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-100">{headerTitle}</h2>
              <p className="mt-2 text-sm font-medium text-slate-400">{headerSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("h-10 w-10 shrink-0 text-slate-100")}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-6 pb-6 pt-4">
          <TransactionDetailContent
            detail={detail}
            loading={loading}
            error={error}
            partyId={partyId}
            compact
          />
        </div>
      </div>
    </div>
  );
}
