"use client";

import { useId } from "react";
import { X } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { displayName } from "@/components/app/wallet/token-logo";
import type { WalletToken } from "@/lib/canton/token-types";

/**
 * Modal "Confirm transaction" — langkah REVIEW sebelum eksekusi Send.
 *
 * Dibuka setelah user klik "Send" di form (lihat wallet-actions.tsx). Modal ini
 * TIDAK melakukan fetch / tidak mengeksekusi transfer — ia hanya menampilkan
 * ringkasan (amount, token, recipient, memo, network, platform fee) lalu
 * memanggil `onConfirm()` bila user yakin. Eksekusi sebenarnya tetap di handler
 * pemilik (submitSend di wallet-actions), supaya auto-route CC/non-CC dan logic
 * fee tidak duplikat di sini.
 *
 * Shell: Variant B (bg-[var(--card)] + rounded-3xl), konsisten dengan cc-lock-modal
 * & transaction-detail-modal.
 */
interface SendConfirmModalProps {
  open: boolean;
  busy?: boolean;
  /** Token yang dipilih di form. */
  token: WalletToken | null;
  /** Amount (raw string input user). Ditampilkan apa adanya. */
  amount: string;
  /** Recipient sudah di-normalize & di-format untuk display. */
  recipientDisplay: string;
  /** Memo mentah (boleh kosong → tampil "—"). */
  memo: string;
  /** Platform fee CC (dari /api/party/fee-config). Hanya info. */
  feeCc: number;
  onClose: () => void;
  onConfirm: () => void;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="min-w-0 max-w-[60%] truncate text-right text-sm font-medium text-slate-200">
        {children}
      </span>
    </div>
  );
}

export function SendConfirmModal({
  open,
  busy = false,
  token,
  amount,
  recipientDisplay,
  memo,
  feeCc,
  onClose,
  onConfirm,
}: SendConfirmModalProps) {
  const titleId = useId();
  if (!open) return null;

  const tokenName = token ? displayName(token.instrumentId) : "Token";
  const memoDisplay = memo.trim();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto p-4"
      role="presentation"
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 my-auto w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-white/5 bg-[var(--card)] p-6 sm:p-8 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-bold text-slate-100">
            Confirm transaction
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            disabled={busy}
            className={iconButtonClass("h-9 w-9 shrink-0")}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Block amount besar di tengah (tanpa logo) ── */}
        <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-white/5 px-6 py-7 text-center">
          <p className="text-3xl font-bold tabular-nums text-slate-100">
            {amount || "0"} {tokenName}
          </p>
        </div>

        {/* ── Baris detail ── */}
        <dl className="mt-5 divide-y divide-slate-800/60">
          <DetailRow label="Memo">{memoDisplay}</DetailRow>
          <DetailRow label="Network">Canton</DetailRow>
          <DetailRow label="Platform fee">
            <span className="tabular-nums text-amber-400">{feeCc} CC</span>
          </DetailRow>
        </dl>

        {/* ── Tombol ── */}
        <div className="mt-7 flex gap-3">
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            disabled={busy}
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
            disabled={busy}
            className={cn(buttonVariants({ size: "sm" }), "flex-1 gap-2")}
          >
            {busy ? (
              <>
                <LoadingSpinner size="sm" /> Confirming…
              </>
            ) : (
              "Confirm"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
