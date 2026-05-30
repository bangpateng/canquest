"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatApiError } from "@/lib/format-api-error";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

type PreapprovalStatus = {
  hasWallet?: boolean;
  isPlaceholder?: boolean;
  preapproval?: {
    active?: boolean;
    message?: string;
    walletUiUrl?: string | null;
  };
};

interface WalletPreapprovalBannerProps {
  onActivated?: () => void;
}

/** CIP-56 TransferPreapproval status and activation */
export function WalletPreapprovalBanner({ onActivated }: WalletPreapprovalBannerProps) {
  const t = usePlatformT();
  const [status, setStatus] = useState<PreapprovalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/party/preapproval-status", { credentials: "include" });
      if (res.ok) {
        setStatus((await res.json()) as PreapprovalStatus);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/party/ensure-preapproval", {
        method: "POST",
        credentials: "include",
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }
      if (raw && raw.active === true) {
        setStatus((prev) => ({
          ...prev,
          hasWallet: true,
          isPlaceholder: false,
          preapproval: { active: true, message: String(raw.message ?? '') },
        }));
      }
      await load();
      onActivated?.();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3 text-xs text-[var(--muted-foreground)]">
        <LoadingSpinner size="sm" />
        {t("wallet.checkingPreapproval")}
      </div>
    );
  }

  if (!status?.hasWallet) return null;

  if (status.isPlaceholder) {
    return (
      <div className="flex gap-3 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
        <div className="text-xs text-orange-300">
          <p className="font-medium">{t("wallet.walletNotConnected")}</p>
          <p className="mt-1 opacity-90">{t("wallet.walletNotConnectedHint")}</p>
        </div>
      </div>
    );
  }

  const active = status.preapproval?.active === true;

  if (active) {
    return (
      <div className="flex w-full min-w-0 gap-3 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
        <div className="min-w-0 text-xs text-green-200">
          <p className="font-medium">{t("wallet.cip56Active")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          <p className="text-sm font-medium text-[var(--foreground)]">
            {t("wallet.enablePreapproval")}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void activate()}
          className={cn(
            buttonVariants({ size: "sm" }),
            "shrink-0 bg-red-600 text-white shadow-sm hover:bg-red-500 active:scale-[0.99]",
          )}
        >
          {busy ? (
            <>
              <LoadingSpinner size="sm" />
              {t("wallet.enabling")}
            </>
          ) : (
            t("wallet.enablePreapprovalBtn")
          )}
        </button>
      </div>
      {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
