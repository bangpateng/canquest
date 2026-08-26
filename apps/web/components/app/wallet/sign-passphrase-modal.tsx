"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound, LifeBuoy } from "lucide-react";
import Link from "next/link";
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
  const [showHelp, setShowHelp] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Wallet passphrase"
    >
      {/* Backdrop solid — fully hides any modal behind (tx status etc).
          z-95: di atas TransactionStatusModal (z-90) — langkah Sign flow standar. */}
      {/* Backdrop solid — fully hides any modal behind (tx status etc) */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      <div className="relative z-10 my-auto w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl sm:p-8">
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

        {/* Lupa passphrase? — pemulihan via Backup Key (raw hex).
            Non-custodial: TIDAK ada reset via email — server tidak bisa
            membuka blob terenkripsi. Hex backup = master recovery. */}
        <button
          type="button"
          onClick={() => setShowHelp((h) => !h)}
          className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-canton hover:underline"
        >
          <LifeBuoy className="h-3.5 w-3.5" />
          Forgot passphrase?
        </button>
        {showHelp ? (
          <div className="mt-2 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/50 p-4 text-xs leading-relaxed text-[var(--muted-foreground)]">
            <p>
              Your passphrase can&apos;t be reset by email — only you hold your
              keys. If you saved your{" "}
              <strong className="text-[var(--foreground)]">Backup Key</strong>{" "}
              (64-character hex) during wallet setup, you can restore the wallet
              and set a new passphrase:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Copy this transaction&apos;s details — you&apos;ll redo it after restoring</li>
              <li>Cancel this dialog</li>
              <li>
                Open{" "}
                <Link
                  href="/settings"
                  target="_blank"
                  className="font-semibold text-canton underline underline-offset-2"
                >
                  Settings → Wallet Keys
                </Link>{" "}
                → <span className="font-medium">Restore from Backup Key</span>
              </li>
              <li>Paste your backup key and choose a new passphrase</li>
            </ol>
            <p className="mt-2 text-orange-600">
              Lost both passphrase and backup key? The wallet cannot be
              recovered — no one, including us, can restore it.
            </p>
          </div>
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