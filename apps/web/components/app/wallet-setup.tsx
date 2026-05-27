"use client";

import { normalizeWalletUsername } from "@/lib/canton-party-id";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { inputClass } from "@/lib/ui-tokens";
import { formatApiError } from "@/lib/format-api-error";
import { Wallet } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useEffect, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

interface WalletSetupProps {
  onCreated: () => void;
}

/**
 * Shown when a user has no Canton Party ID yet.
 * Requires a one-time wallet invite code (admin-generated) + username.
 */
export function WalletSetup({ onCreated }: WalletSetupProps) {
  const t = usePlatformT();
  const [username, setUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "creating" | "done">("idle");
  const [needsInvite, setNeedsInvite] = useState(true);

  useEffect(() => {
    void fetch("/api/party/wallet-access", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hasRedeemedInvite?: boolean } | null) => {
        if (data && typeof data.hasRedeemedInvite === "boolean") {
          setNeedsInvite(!data.hasRedeemedInvite);
        }
      })
      .catch(() => undefined);
  }, []);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    const val = normalizeWalletUsername(username) ?? "";
    if (!val || val.length < 3) return;
    if (needsInvite && inviteCode.trim().length < 4) return;

    setBusy(true);
    setError(null);
    setStep("creating");

    try {
      const res = await fetch("/api/party/username", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: val,
          ...(needsInvite ? { walletInviteCode: inviteCode.trim() } : {}),
        }),
      });

      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;

      if (!res.ok) {
        setError(formatApiError(raw));
        setStep("idle");
        return;
      }

      if (raw?.isPlaceholder === true) {
        setError(
          "Wallet created with a placeholder Party ID — your SSH tunnel to the Canton participant is not active. " +
            "Connect the tunnel and use Settings to get a real Party ID.",
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
        <div className="mb-6 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-canton/30 bg-canton/10">
            <Wallet className="h-8 w-8 text-canton" />
          </div>
        </div>

        <h2 className="type-page-title text-center">{t("wallet.createTitle")}</h2>
        <p className="mt-2 text-center text-sm text-[var(--muted-foreground)]">
          {needsInvite ? t("wallet.inviteCodeHint") : t("wallet.inviteCodeRetryHint")}
        </p>

        <form onSubmit={handleGenerate} className="mt-8 space-y-4">
          {needsInvite ? (
            <div className="space-y-1.5">
              <label
                htmlFor="wallet-invite-code"
                className="text-xs font-medium text-[var(--muted-foreground)]"
              >
                {t("wallet.inviteCodeLabel")}
              </label>
              <input
                id="wallet-invite-code"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="WQ-XXXXXXXX"
                minLength={4}
                maxLength={64}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                required
                disabled={busy || step === "done"}
                className={cn(inputClass, "font-mono uppercase")}
              />
            </div>
          ) : null}

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
              onChange={(e) =>
                setUsername(
                  e.target.value.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, ""),
                )
              }
              placeholder="e.g. alex_canton"
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9_]+"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={busy || step === "done"}
              className={cn(inputClass, "font-mono")}
            />
          </div>

          {error ? (
            <p
              className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-sm text-orange-300"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={
              busy ||
              step === "done" ||
              username.trim().length < 3 ||
              (needsInvite && inviteCode.trim().length < 4)
            }
            className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
          >
            {step === "creating" ? (
              <>
                <LoadingSpinner size="md" />
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
        </form>
      </div>
    </div>
  );
}
