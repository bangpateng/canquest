"use client";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { formatApiError } from "@/lib/format-api-error";
import { Loader2, Wallet } from "lucide-react";
import { useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

interface WalletSetupProps {
  onCreated: () => void;
}

/**
 * Shown when a user has no Canton Party ID yet.
 * They enter a username → one click → wallet is generated on the Canton participant.
 */
export function WalletSetup({ onCreated }: WalletSetupProps) {
  const t = usePlatformT();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "creating" | "done">("idle");

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const val = username.trim();
    if (!val) return;

    setBusy(true);
    setError(null);
    setStep("creating");

    try {
      const res = await fetch("/api/party/username", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: val }),
      });

      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;

      if (!res.ok) {
        setError(formatApiError(raw));
        setStep("idle");
        return;
      }

      if (raw?.isPlaceholder === true) {
        // Canton not reachable → show warning but still proceed
        setError(
          "Wallet created with a placeholder Party ID — your SSH tunnel to the Canton participant is not active. " +
          "Connect the tunnel and use Settings to get a real Party ID."
        );
      }

      setStep("done");
      setTimeout(() => onCreated(), 1200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
      <div className="w-full min-w-0 max-w-md">
        {/* Icon */}
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-canton/30 bg-canton/10">
            <Wallet className="h-8 w-8 text-canton" />
          </div>
        </div>

        <h2 className="type-page-title text-center">
          Create Your Wallet
        </h2>
        <p className="mt-2 text-center text-sm text-[var(--muted-foreground)]">
          Choose a username — this becomes your identity on the{" "}
          <strong className="font-medium text-[var(--foreground)]">Canton Network</strong> ledger.
          It cannot be changed later.
        </p>

        <form onSubmit={handleGenerate} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="wallet-username"
              className="text-xs font-medium text-[var(--muted-foreground)]"
            >
              Username{" "}
              <span className="font-normal text-[var(--muted-foreground)]/70">
                (letters, numbers, underscore · 3–32 chars)
              </span>
            </label>
            <input
              id="wallet-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. alex_canton"
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_]+"
              required
              disabled={busy || step === "done"}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 font-mono text-sm text-[var(--foreground)] outline-none ring-[var(--ring)] placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 disabled:opacity-50"
            />
          </div>

          {error && (
            <p
              className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-300 dark:text-orange-300"
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || step === "done" || username.trim().length < 3}
            className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
          >
            {step === "creating" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("wallet.generatingWallet")}
              </>
            ) : step === "done" ? (
              t("wallet.walletCreatedLoading")
            ) : (
              <>
                <Wallet className="h-4 w-4" />
                {t("wallet.generateWallet")}
              </>
            )}
          </button>

          <p className="text-center text-[11px] text-[var(--muted-foreground)]">
            Your Party ID is allocated on your validator&apos;s Canton participant node via the
            JSON Ledger API.
          </p>
        </form>
      </div>
    </div>
  );
}
