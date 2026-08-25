"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { inputClass } from "@/lib/ui/ui-tokens";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

/**
 * SignPassphraseModal — wallet passphrase prompt before signing a
 * transaction (M3b). Used by send/lock/offer/claim/swap flows for external
 * users when the wallet is locked (session not unlocked yet).
 *
 * The passphrase is never sent to the server — it only unlocks the local
 * browser key (key-manager).
 */
export interface SignPassphraseModalProps {
  open: boolean;
  /** Description of the transaction to be signed, e.g. "Send 5 CC to @karel". */
  description?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
}

export function SignPassphraseModal({
  open,
  description,
  busy,
  error,
  onSubmit,
  onCancel,
}: SignPassphraseModalProps) {
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Wallet passphrase"
    >
      <div className="modal-backdrop w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-canton-muted bg-canton-subtle">
            <KeyRound className="h-6 w-6 text-canton" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              Sign Transaction
            </h2>
            {description ? (
              <p className="truncate text-sm text-[var(--muted-foreground)]">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-[var(--muted-foreground)]">
          Enter your wallet passphrase to sign. The passphrase is only used in
          this browser — it is never sent to any server.
        </p>

        <div className="relative">
          <input
            type={show ? "text" : "password"}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="Wallet passphrase"
            autoFocus
            disabled={busy}
            className={cn(inputClass, "pr-11 font-mono")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && pass.length >= 8 && !busy) {
                onSubmit(pass);
              }
            }}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            aria-label={show ? "Hide passphrase" : "Show passphrase"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-orange-600">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            disabled={busy || pass.length < 8}
            onClick={() => onSubmit(pass)}
            className={cn(buttonVariants(), "flex-1 gap-2")}
          >
            {busy ? <LoadingSpinner size="sm" /> : <KeyRound className="h-4 w-4" />}
            Sign
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className={buttonVariants({ variant: "ghost" })}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
