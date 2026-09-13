"use client";

import { Loader2, X } from "lucide-react";

import { TransactionDetailContent } from "@/components/app/wallet/transaction-detail-content";
import type { TransactionDetail } from "@/components/app/wallet/transaction-detail-view";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { useTransactionDetail } from "@/lib/hooks/use-transaction-detail";
import { txTypeLabel, type TxType } from "@/lib/canton/tx-labels";
import { TxTypeIcon, txIconBg } from "@/lib/canton/tx-icons";
import { usePlatformT } from "@/lib/i18n/platform-provider";

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
  const t = usePlatformT();
  const { detail, loading, error } = useTransactionDetail(
    open ? transactionId : null,
  );

  if (!open) return null;

  // Header mengikuti TIPE transaksi — bukan tebakan arah. Dulu header
  // hardcode "Receive"/"Send" + panah untuk SEMUA tipe di luar daftar masuk,
  // sehingga detail Lock/Unlock berjudul "Send" dengan panah merah padahal
  // Type di dalamnya benar (laporan owner 2026-09-13, muncul di PC mana pun).
  const headerTitle =
    title ?? (detail ? txTypeLabel(detail.type, t) : "Transaction");
  const headerSubtitle = subtitle ?? "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto overscroll-contain p-4 sm:items-center sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="modal-backdrop"
        title="Close" aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 my-auto flex w-full min-w-0 max-h-[calc(100dvh-6.75rem)] md:max-h-[min(92vh,92dvh)] max-w-md flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-xl sm:max-h-[min(90vh,90dvh)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
          <div className="flex min-w-0 items-center gap-4">
            {loading || !detail ? (
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)]"
                aria-hidden
              >
                <Loader2 className="h-5 w-5 spin" />
              </span>
            ) : (
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  txIconBg(detail.type as TxType),
                )}
                aria-hidden
              >
                <TxTypeIcon type={detail.type as TxType} />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-xl font-bold leading-10 text-[var(--foreground)]">{headerTitle}</h2>
              {headerSubtitle ? (
                <p className="mt-2 text-sm font-medium text-[var(--muted-foreground)]">{headerSubtitle}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("h-10 w-10 shrink-0 text-[var(--foreground)]")}
            title="Close" aria-label="Close"
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
