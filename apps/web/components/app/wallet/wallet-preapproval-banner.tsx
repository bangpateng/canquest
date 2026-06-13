"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { formatApiError } from "@/lib/api/format-api-error";
import { AlertCircle, CheckCircle2, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

type PreapprovalStatus = {
  hasWallet?: boolean;
  isPlaceholder?: boolean;
  preapproval?: {
    active?: boolean;
    expiresAt?: string | null;
    message?: string;
    walletUiUrl?: string | null;
  };
  // New API format
  active?: boolean;
  expiresAt?: string | null;
  provider?: string | null;
  message?: string;
};

interface WalletPreapprovalBannerProps {
  onActivated?: () => void;
  /** Show as a compact toggle instead of a banner */
  variant?: "banner" | "toggle";
}

/** CIP-56 TransferPreapproval status, activation, and deactivation */
export function WalletPreapprovalBanner({
  onActivated,
  variant = "banner",
}: WalletPreapprovalBannerProps) {
  const t = usePlatformT();
  const [status, setStatus] = useState<PreapprovalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Try new endpoint first, fallback to old
      let res = await fetch("/api/party/preapproval", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as PreapprovalStatus;
        setStatus({
          hasWallet: true,
          isPlaceholder: false,
          preapproval: {
            active: data.active,
            expiresAt: data.expiresAt,
            message: data.message,
          },
          ...data,
        });
        return;
      }
      // Fallback to old endpoint
      res = await fetch("/api/party/preapproval-status", { credentials: "include" });
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
    setSuccessMsg(null);
    try {
      // Try new endpoint first
      let res = await fetch("/api/party/preapproval/enable", {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 404) {
        // Fallback to old endpoint
        res = await fetch("/api/party/ensure-preapproval", {
          method: "POST",
          credentials: "include",
        });
      }
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }
      setSuccessMsg("Preapproval enabled — incoming CC transfers arrive directly.");
      await load();
      onActivated?.();
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/party/preapproval/disable", {
        method: "POST",
        credentials: "include",
      });
      const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }
      setSuccessMsg("Preapproval disabled — incoming CC will appear as offers.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-[var(--muted)]/25 px-6 py-4 text-sm font-medium text-slate-400">
        <LoadingSpinner size="sm" />
        {t("wallet.checkingPreapproval")}
      </div>
    );
  }

  if (!status?.hasWallet && status?.active === undefined) return null;

  if (status?.isPlaceholder) {
    return (
      <div className="flex gap-4 rounded-2xl border border-orange-500/30 bg-orange-500/10 px-6 py-4">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
        <div className="text-sm font-medium text-orange-300">
          <p className="font-semibold">{t("wallet.walletNotConnected")}</p>
          <p className="mt-2 opacity-90">{t("wallet.walletNotConnectedHint")}</p>
        </div>
      </div>
    );
  }

  const active =
    status?.active === true || status?.preapproval?.active === true;

  // ── Toggle variant ────────────────────────────────────────────────────────
  if (variant === "toggle") {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {active ? (
              <ShieldCheck className="h-5 w-5 shrink-0 text-green-400" />
            ) : (
              <ShieldOff className="h-5 w-5 shrink-0 text-slate-500" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-100">
                Transfer Preapproval
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {active
                  ? "Incoming CC arrives directly"
                  : "Incoming CC requires manual accept"}
              </p>
            </div>
          </div>

          {/* Toggle switch */}
          <button
            type="button"
            disabled={busy}
            onClick={() => (active ? void deactivate() : void activate())}
            role="switch"
            aria-checked={active}
            aria-label="Toggle transfer preapproval"
            className="relative shrink-0"
          >
            {busy ? (
              <div className="flex h-6 w-11 items-center justify-center rounded-full bg-slate-700">
                <LoadingSpinner size="sm" />
              </div>
            ) : (
              <div
                className={cn(
                  "h-6 w-11 rounded-full transition-colors duration-200",
                  active ? "bg-green-600" : "bg-slate-700",
                )}
              >
                <div
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
                    active ? "translate-x-[22px]" : "translate-x-0.5",
                  )}
                />
              </div>
            )}
          </button>
        </div>

        {/* Expiry info */}
        {active && (status?.expiresAt || status?.preapproval?.expiresAt) && (
          <p className="mt-2 text-[11px] text-slate-600">
            Expires:{" "}
            {new Date(
              (status.expiresAt ?? status.preapproval?.expiresAt)!
            ).toLocaleDateString()}{" "}
            · Auto-renewed by validator
          </p>
        )}

        {/* Error / Success */}
        {error && (
          <p className="mt-3 text-sm font-medium text-red-400">{error}</p>
        )}
        {successMsg && (
          <p className="mt-3 text-sm font-medium text-green-400">{successMsg}</p>
        )}
      </div>
    );
  }

  // ── Banner variant (original) ──────────────────────────────────────────────
  if (active) {
    return (
      <div className="flex w-full min-w-0 items-center justify-between gap-4 rounded-2xl border border-green-500/30 bg-green-500/10 px-6 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
          <div className="min-w-0 text-sm font-medium text-green-200">
            <p className="font-semibold">{t("wallet.cip56Active")}</p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void deactivate()}
          className={cn(
            buttonVariants({ size: "sm", variant: "secondary" }),
            "shrink-0 gap-1.5 text-slate-400 hover:text-red-400 border-white/10 hover:border-red-500/30",
          )}
        >
          {busy ? (
            <LoadingSpinner size="sm" />
          ) : (
            <ShieldOff className="h-3.5 w-3.5" />
          )}
          Disable
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-[var(--muted)]/25 px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <ShieldCheck className="h-5 w-5 shrink-0 text-slate-400" />
          <p className="text-base font-semibold text-slate-100">
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
      {error ? <p className="mt-4 text-sm font-medium text-red-400">{error}</p> : null}
      {successMsg ? <p className="mt-4 text-sm font-medium text-green-400">{successMsg}</p> : null}
    </div>
  );
}
