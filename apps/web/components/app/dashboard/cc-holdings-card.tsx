"use client";

import { useLockStatus } from "@/lib/hooks/use-lock-status";
import { useCcPrice } from "@/lib/hooks/use-cc-price";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";

function formatCc(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: n >= 1 ? 2 : 4,
    maximumFractionDigits: n >= 1 ? 2 : 4,
  });
}

function formatUsd(usd: number): string {
  return usd >= 1 ? usd.toFixed(2) : usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4);
}

export interface CcHoldingsCardProps {
  hasWallet: boolean;
}

export function CcHoldingsCard({ hasWallet }: CcHoldingsCardProps) {
  const t = usePlatformT();
  const { status, loading } = useLockStatus({ enabled: hasWallet });
  const { price } = useCcPrice();

  if (!hasWallet) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[var(--card)]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-500/10 ring-1 ring-slate-500/20">
            <Wallet className="h-5 w-5 text-slate-400" aria-hidden />
          </div>
          <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            {t("dashboard.ccBalance")}
          </span>
        </div>
        <p className="mt-4 text-sm font-medium text-slate-400">
          {t("dashboard.noWalletCreate")}
        </p>
        <Link
          href="/wallet"
          className="mt-4 inline-flex items-center rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
        >
          {t("dashboard.createWallet")}
        </Link>
      </div>
    );
  }

  const available = status.availableCc ?? 0;
  const locked = status.lockedCc ?? 0;
  const total = available + locked;
  const availableUsd = price ? available * price : null;
  const lockedUsd = price ? locked * price : null;
  const totalUsd = price ? total * price : null;
  const lockedPct = total > 0 ? (locked / total) * 100 : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-[var(--card)]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 transition-all duration-300 hover:border-white/[0.08] p-5 sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_100%_0%,rgb(59_130_246/0.08),transparent_70%)]"
        aria-hidden
      />
      <div className="relative">
        <div className="flex items-start justify-between">
          <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            {t("dashboard.ccBalance")}
          </span>
          {totalUsd !== null && (
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {t("dashboard.portfolioValue")}
              </p>
              <p className="text-sm font-bold tabular-nums text-white">${formatUsd(totalUsd)}</p>
            </div>
          )}
        </div>

        {/* Available */}
        <div className="mt-5 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-400">{t("dashboard.availableCc")}</span>
          <div className="text-right">
            {loading ? (
              <span className="text-sm text-slate-600">…</span>
            ) : (
              <>
                <p className="flex items-center justify-end gap-1.5 text-base font-bold tabular-nums text-white">
                  <CcRewardLogo size={16} className="text-canton" />
                  {formatCc(available)}
                </p>
                {availableUsd !== null && (
                  <p className="text-[11px] tabular-nums text-slate-500">≈ ${formatUsd(availableUsd)}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Locked */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-400">{t("dashboard.lockedCc")}</span>
          <div className="text-right">
            {loading ? (
              <span className="text-sm text-slate-600">…</span>
            ) : (
              <>
                <p className="flex items-center justify-end gap-1.5 text-base font-bold tabular-nums text-white">
                  <CcRewardLogo size={16} className="text-amber-400" />
                  {formatCc(locked)}
                </p>
                {lockedUsd !== null && (
                  <p className="text-[11px] tabular-nums text-slate-500">≈ ${formatUsd(lockedUsd)}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Split bar */}
        <div className="mt-5">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
              style={{ width: `${Math.max(0, 100 - lockedPct)}%` }}
            />
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-orange-400"
              style={{ width: `${Math.min(100, lockedPct)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400" /> {t("dashboard.availableCc")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {t("dashboard.lockedCc")} <span className="h-2 w-2 rounded-full bg-amber-400" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
