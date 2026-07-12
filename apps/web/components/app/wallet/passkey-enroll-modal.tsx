"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Fingerprint, X, AlertCircle } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";
import { usePasskey } from "@/lib/hooks/use-passkey";

/**
 * PasskeyEnrollModal — forced enrollment saat user pertama kali send/swap dan belum
 * punya passkey (backend return code: PASSKEY_NOT_ENROLLED).
 *
 * Flow:
 *   1. User klik "Setup Passkey" → enrollPasskey() (browser registration prompt)
 *   2. Tampilkan 10 backup codes (WAJIB simpan — checkbox konfirmasi)
 *   3. Setelah user confirm "saya sudah simpan" → onEnrolled() → caller retry transaksi
 *
 * Backup codes = recovery kalau SEMUA device hilang. Display SEKALI saja (tidak bisa
 * re-show tanpa regenerate).
 */
interface PasskeyEnrollModalProps {
  open: boolean;
  onClose: () => void;
  /** Dipanggil setelah enrollment sukses + user confirm simpan backup codes. */
  onEnrolled: () => void;
}

export function PasskeyEnrollModal({ open, onClose, onEnrolled }: PasskeyEnrollModalProps) {
  const titleId = useId();
  const { enrollPasskey, isSupported } = usePasskey();
  const supported = isSupported();

  const [step, setStep] = useState<"intro" | "enrolling">("intro");
  const [error, setError] = useState("");

  // Reset state saat modal dibuka.
  useEffect(() => {
    if (open) {
      setStep("intro");
      setError("");
    }
  }, [open]);

  // Esc untuk menutup (kecuali sedang enrolling).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && step !== "enrolling") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, onClose]);

  const handleEnroll = useCallback(async () => {
    setStep("enrolling");
    setError("");
    try {
      await enrollPasskey();
      // Success — no backup codes display (generated internally for admin recovery).
      onEnrolled();
    } catch (err) {
      const msg = (err as Error).message || "";
      if (
        msg.includes("cancel") ||
        msg.includes("aborted") ||
        msg.includes("NotAllowed")
      ) {
        setError("Registration cancelled. Try again.");
      } else {
        setError(msg || "Passkey registration failed.");
      }
      setStep("intro");
    }
  }, [enrollPasskey, onEnrolled]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto p-4"
      role="presentation"
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={() => {
          if (step !== "enrolling") onClose();
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
              Setup Passkey
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              if (step !== "enrolling") onClose();
            }}
            disabled={step === "enrolling"}
            className={iconButtonClass("h-9 w-9 shrink-0")}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* STEP: intro */}
        {step === "intro" && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-slate-400">
              Passkey (Face ID / Touch ID / PIN) secures every transaction —
              send, swap, lock. Safer than a password: can&rsquo;t be guessed,
              can&rsquo;t be stolen via phishing.
            </p>

            {!supported ? (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-sm font-medium text-amber-400">
                  Your browser/device doesn&rsquo;t support passkey. Use a
                  modern browser (Chrome/Safari/Edge latest) with an
                  authenticator.
                </p>
              </div>
            ) : null}

            {error ? (
              <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <p className="text-sm font-medium text-red-400">{error}</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleEnroll}
              disabled={!supported}
              className={cn(buttonVariants({ size: "sm" }), "w-full gap-2")}
            >
              <Fingerprint className="h-4 w-4" /> Start Passkey Setup
            </button>
            <button
              type="button"
              onClick={onClose}
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" }),
                "w-full",
              )}
            >
              Not now
            </button>
          </div>
        )}

        {/* STEP: enrolling (browser prompt aktif) */}
        {step === "enrolling" && (
          <div className="mt-6 flex flex-col items-center gap-4 py-8">
            <LoadingSpinner />
            <p className="text-sm font-medium text-slate-300">
              Waiting for passkey confirmation on your device…
            </p>
            <p className="text-xs text-slate-500">
              Follow your browser prompt (Face ID / Touch ID / PIN).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
