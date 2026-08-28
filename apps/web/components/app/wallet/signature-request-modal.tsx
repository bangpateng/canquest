"use client";

import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { apiOrigin } from "@/components/app/wallet/token-logo";
import { cn } from "@/lib/utils/utils";

/**
 * SignatureRequestModal — konfirmasi tanda tangan ala wallet (mockup
 * `Signature Request`). Menggantikan prompt passphrase pada alur sign:
 * dompet sudah auto-unlock (device key), jadi user cukup menekan tombol.
 *
 * Layering: z-[85] — di atas review (z-60), DI BAWAH TransactionStatusModal
 * (z-90, backdrop opaque) supaya status broadcast/success mengambil alih
 * begitu tanda tangan selesai.
 */
export interface SignaturePayloadRow {
  label: string;
  value: string;
}

export interface SignatureRequestModalProps {
  open: boolean;
  /** Baris payload yang ditampilkan (Action, Token, Amount, To, …). */
  payload: SignaturePayloadRow[];
  /** true = tombol Sign disabled + spinner ("Signing…"). */
  busy?: boolean;
  onSign: () => void;
  onReject: () => void;
}

export function SignatureRequestModal({
  open,
  payload,
  busy,
  onSign,
  onReject,
}: SignatureRequestModalProps) {
  // Logo CanQuest dari R2 (128×128 source, tampil 40×40). Fallback: huruf CQ.
  const [logoError, setLogoError] = useState(false);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Signature request"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
      <div className="relative z-10 my-auto w-full max-w-[380px] rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.2)]">
        {/* Wallet header — identitas peminta tanda tangan (logo brand) */}
        <div className="mb-5 flex items-center gap-3 border-b border-[var(--border)] pb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            {logoError ? (
              <span className="text-sm font-bold text-canton">CQ</span>
            ) : (
              <img
                src={`${apiOrigin()}/api/uploads/token-logo/canquest-logo`}
                alt="CanQuest"
                onError={() => setLogoError(true)}
                className="h-full w-full object-contain"
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-[var(--foreground)]">
              Signature Request
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">canquest.cc</p>
          </div>
        </div>

        {/* Payload box — monospace, ala wallet extension */}
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3.5 font-mono text-xs leading-relaxed">
          <p className="text-[var(--muted-foreground)]/70">
            // Transaction Payload
          </p>
          {payload.map((row) => (
            <p key={row.label} className="mt-0.5 break-all">
              <span className="text-[var(--muted-foreground)]">
                {row.label}:
              </span>{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {row.value}
              </span>
            </p>
          ))}
        </div>

        <p className="mb-5 text-xs leading-relaxed text-[var(--muted-foreground)]">
          Your key signs this transaction in your browser — it never leaves
          your device.
        </p>

        {/* Actions — style tombol dapp (secondary + primary) */}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className={cn(
              buttonVariants({ variant: "secondary" }),
              "flex-1 py-3.5 text-base",
            )}
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSign}
            className={cn(buttonVariants({}), "flex-1 gap-2 py-3.5 text-base")}
          >
            {busy ? (
              <>
                <LoadingSpinner size="sm" />
                Signing…
              </>
            ) : (
              "Sign & Send"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
