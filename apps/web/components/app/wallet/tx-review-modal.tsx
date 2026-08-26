"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

/**
 * TxReviewModal — langkah REVIEW standar untuk SEMUA transaksi on-chain.
 *
 * Urutan flow web3 yang seragam di seluruh dapp:
 *   Input → Review (modal ini) → Sign → Broadcast → Success / Failed.
 *
 * Modal ini murni presentasi: menampilkan ringkasan transaksi lalu memanggil
 * `onConfirm()`. Eksekusi & signing tetap di handler pemilik flow — setelah
 * Confirm, pemilik flow MENUTUP modal ini dan membuka TransactionStatusModal
 * (z-90, backdrop opaque) supaya hanya satu modal terlihat pada satu waktu.
 */
export interface TxReviewRow {
  label: string;
  value: string;
  /** Render value dengan font mono (alamat, hash, id). */
  mono?: boolean;
  /** Kelas warna tambahan untuk value (mis. "text-canton", "text-red-600"). */
  valueClass?: string;
}

interface TxReviewModalProps {
  open: boolean;
  /** Judul modal. Default "Confirm transaction". */
  title?: string;
  /** Headline besar di tengah, mis. "5 CC" atau "10 CC → 9.94 USDCx". */
  amountText: string;
  /** Baris kecil di bawah headline (mis. label token atau penerima). */
  subText?: string;
  /** Baris detail transaksi (Recipient, Memo, Fee, Network, …). */
  rows: TxReviewRow[];
  /** Catatan kecil di bawah detail (mis. info fee holding lock). */
  note?: string;
  /** Label tombol konfirmasi. Default "Confirm". */
  confirmLabel?: string;
  /** Varian warna tombol konfirmasi (default primary). */
  confirmVariant?: "primary" | "secondary";
  /** true = tombol konfirmasi merah (aksi destruktif: Reject/Withdraw). */
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function DetailRow({ row }: { row: TxReviewRow }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {row.label}
      </span>
      <span
        className={cn(
          "min-w-0 max-w-[60%] break-all text-right text-sm font-medium text-[var(--foreground)]",
          row.mono && "font-mono text-xs leading-relaxed",
          row.valueClass,
        )}
      >
        {row.value}
      </span>
    </div>
  );
}

export function TxReviewModal({
  open,
  title = "Confirm transaction",
  amountText,
  subText,
  rows,
  note,
  confirmLabel = "Confirm",
  danger = false,
  onClose,
  onConfirm,
}: TxReviewModalProps) {
  const titleId = useId();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4"
      role="presentation"
    >
      <button
        type="button"
        className="modal-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 my-auto w-full max-w-md max-h-[calc(100dvh-6.75rem)] md:max-h-[min(92vh,92dvh)] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl sm:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-bold text-[var(--foreground)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("h-9 w-9 shrink-0")}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Headline amount di tengah ── */}
        <div className="mt-6 flex flex-col items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--muted)] px-6 py-7 text-center">
          <p className="text-3xl font-bold tabular-nums text-[var(--foreground)]">
            {amountText}
          </p>
          {subText ? (
            <p className="mt-1 text-sm font-medium text-[var(--muted-foreground)]">
              {subText}
            </p>
          ) : null}
        </div>

        {/* ── Baris detail ── */}
        <dl className="mt-5 divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <DetailRow key={row.label} row={row} />
          ))}
        </dl>

        {note ? (
          <p className="mt-3 text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
            {note}
          </p>
        ) : null}

        {/* ── Tombol ── */}
        <div className="mt-7 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "flex-1",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              danger
                ? buttonVariants({ variant: "secondary", size: "sm" })
                : buttonVariants({ size: "sm" }),
              "flex-1 gap-2",
              danger &&
                "border-red-500/30 text-red-600 hover:border-red-500/50 hover:text-red-500",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
