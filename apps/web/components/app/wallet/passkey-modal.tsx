"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Fingerprint, X, AlertCircle } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { usePasskey } from "@/lib/hooks/use-passkey";

/**
 * PasskeyModal — gate transaksi via WebAuthn (menggantikan WalletPasswordModal).
 *
 * Bukan input password → tombol "Verify" yang trigger browser prompt (Face ID/Touch ID/PIN).
 * Saat verify sukses → call onVerified(verificationToken) — token dikirim ke endpoint
 * transaksi sebagai `txVerification` (90s JWT, cukup untuk swap retry).
 *
 * Flow:
 *   1. User klik "Verify" → authenticatePasskey() (browser prompt biometric)
 *   2. Backend verify assertion → return verification token
 *   3. onVerified(token) → caller kirim token ke endpoint transaksi
 *
 * Bila device tidak support WebAuthn (browser lama) → tampilkan pesan error.
 */
interface PasskeyModalProps {
  open: boolean;
  /** Judul aksi yang sedang digate, mis. "Send", "Lock", "Swap". */
  actionLabel: string;
  /** Pesan error dari pemanggil (mis. hasil fetch 403/expired). Kosongkan bila tidak ada. */
  error?: string;
  /** Sedang memproses aksi transaksi (disable tombol). */
  busy?: boolean;
  onClose: () => void;
  /** Callback dipanggil dengan verification token (90s JWT) saat passkey verify sukses. */
  onVerified: (token: string) => void;
}

export function PasskeyModal({
  open,
  actionLabel,
  error,
  busy,
  onClose,
  onVerified,
}: PasskeyModalProps) {
  const titleId = useId();
  const { authenticatePasskey, isSupported } = usePasskey();
  const [verifying, setVerifying] = useState(false);
  const [localError, setLocalError] = useState("");
  const supported = isSupported();

  // Reset state setiap kali modal dibuka.
  useEffect(() => {
    if (open) {
      setLocalError("");
      setVerifying(false);
    }
  }, [open]);

  // Esc untuk menutup (kecuali sedang sibuk).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy && !verifying) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, verifying, onClose]);

  const handleVerify = useCallback(async () => {
    if (busy || verifying) return;
    setVerifying(true);
    setLocalError("");
    try {
      const token = await authenticatePasskey();
      onVerified(token);
    } catch (err) {
      const msg = (err as Error).message || "";
      // User cancel browser prompt → pesan friendly.
      if (
        msg.includes("cancel") ||
        msg.includes("aborted") ||
        msg.includes("NotAllowed")
      ) {
        setLocalError("Verifikasi dibatalkan. Coba lagi.");
      } else {
        setLocalError(msg || "Verifikasi passkey gagal.");
      }
    } finally {
      setVerifying(false);
    }
  }, [busy, verifying, authenticatePasskey, onVerified]);

  if (!open) return null;

  const busyState = busy || verifying;

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
          if (!busyState) onClose();
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
            <Fingerprint className="h-5 w-5 text-emerald-400" aria-hidden />
            <h2 id={titleId} className="text-xl font-bold text-slate-100">
              Confirm {actionLabel}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!busyState) onClose();
            }}
            disabled={busyState}
            className={iconButtonClass("h-9 w-9 shrink-0")}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-400">
          Verifikasi pakai passkey (Face ID / Touch ID / PIN) untuk konfirmasi{" "}
          {actionLabel.toLowerCase()}.
        </p>

        {!supported ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-sm font-medium text-amber-400">
              Browser/device Anda tidak mendukung passkey. Gunakan browser modern
              (Chrome, Safari, Edge versi terbaru) dengan authenticator (sidik
              jari, Face ID, atau PIN).
            </p>
          </div>
        ) : null}

        {(localError || error) && supported ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-sm font-medium text-red-400">
              {localError || error}
            </p>
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={handleVerify}
            disabled={busyState || !supported}
            className={cn(buttonVariants({ size: "sm" }), "w-full gap-2")}
          >
            {verifying ? (
              <>
                <LoadingSpinner size="sm" /> Menunggu verifikasi…
              </>
            ) : (
              <>
                <Fingerprint className="h-4 w-4" /> Verify {actionLabel}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!busyState) onClose();
            }}
            disabled={busyState}
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              "w-full",
            )}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
