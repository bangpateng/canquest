"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ShieldCheck, X, AlertCircle, Eye, EyeOff } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

/**
 * Modal konfirmasi kata sandi transaksi (wallet password) untuk gate
 * Send / Lock / Unlock. Muncul hanya bila user telah menetapkan wallet password
 * di Settings.
 *
 * Modal ini TIDAK memverifikasi sendiri — ia hanya menampung input lalu memanggil
 * `onConfirm(password)`. Verifikasi sebenarnya terjadi di backend saat aksi
 * sensitif dieksekusi (password dikirim sebagai bagian body request).
 *
 * Bila pemanggil melaporkan kegagalan lewat `error` prop, modal menampilkannya
 * dan membiarkan user mencoba lagi (tidak ditutup).
 */
interface WalletPasswordModalProps {
  open: boolean;
  /** Judul aksi yang sedang digate, mis. "Send", "Lock", "Unlock". */
  actionLabel: string;
  /** Pesan error dari pemanggil (mis. hasil fetch 403). Kosongkan bila tidak ada. */
  error?: string;
  /** Sedang memproses aksi (disable input + tombol). */
  busy?: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
}

export function WalletPasswordModal({
  open,
  actionLabel,
  error,
  busy,
  onClose,
  onConfirm,
}: WalletPasswordModalProps) {
  const titleId = useId();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  // Reset input setiap kali modal dibuka.
  useEffect(() => {
    if (open) {
      setPassword("");
      setShow(false);
    }
  }, [open]);

  // Esc untuk menutup (kecuali sedang sibuk).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!password || busy) return;
      onConfirm(password);
    },
    [password, busy, onConfirm],
  );

  if (!open) return null;

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
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden />
            <h2 id={titleId} className="text-xl font-bold text-slate-100">
              Confirm {actionLabel}
            </h2>
          </div>
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

        <p className="mt-3 text-sm text-slate-400">
          {actionLabel.toLowerCase()}.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="wallet-password-input"
              className="text-sm font-medium text-slate-400"
            >
              Wallet password
            </label>
            <div className="relative">
              <input
                id="wallet-password-input"
                type={show ? "text" : "password"}
                autoComplete="off"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={busy}
                className="w-full rounded-2xl border border-white/5 bg-white/5 px-4 py-3 pr-11 text-base font-medium text-slate-100 outline-none placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-200"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="text-sm font-medium text-red-400">{error}</p>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy || !password}
            className={cn(buttonVariants({ size: "sm" }), "w-full gap-2")}
          >
            {busy ? (
              <>
                <LoadingSpinner size="sm" /> Confirming…
              </>
            ) : (
              `Confirm ${actionLabel}`
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            disabled={busy}
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "w-full",
            )}
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
