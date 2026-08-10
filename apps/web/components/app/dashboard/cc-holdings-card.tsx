"use client";

import { useLockStatus } from "@/lib/hooks/use-lock-status";
import { useCcPrice } from "@/lib/hooks/use-cc-price";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Wallet, Lock, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { Card } from "@/components/ui/card";

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

  // ── No wallet state ──
  if (!hasWallet) {
    return (
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--muted)]">
            <Wallet className="h-6 w-6 text-[var(--muted-foreground)]" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              {t("dashboard.ccBalance")}
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("dashboard.noWalletCreate")}
            </p>
          </div>
          <Link
            href="/wallet"
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            {t("dashboard.createWallet")}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </Card>
    );
  }

  // ── Main portfolio card (redesigned) ──
  const available = status.availableCc ?? 0;
  const locked = status.lockedCc ?? 0;
  const total = available + locked;
  const availableUsd = price ? available * price : null;
  const lockedUsd = price ? locked * price : null;
  const totalUsd = price ? total * price : null;
  const lockedPct = total > 0 ? Math.round((locked / total) * 100) : 0;

  return (
    <Card interactive className="overflow-hidden p-6 sm:p-7">
      <div>
        {/* ── Balance hero ── */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <CcRewardLogo size={28} className="text-canton" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {t("dashboard.ccBalance")}
              </p>
              <p className="mt-0.5 text-3xl font-extrabold tabular-nums tracking-tight text-[var(--foreground)] glow-text">
                {loading ? "…" : formatCc(total)}
              </p>
            </div>
          </div>
          {totalUsd !== null && !loading ? (
            <div className="rounded-xl bg-[var(--muted)] px-3 py-1.5 text-right">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Value
              </p>
              <p className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                ${formatUsd(totalUsd)}
              </p>
            </div>
          ) : null}
        </div>

        {/* ── Split breakdown ── */}
        <div className="mt-6 space-y-3">
          {/* Available row */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <span className="h-2 w-2 rounded-full bg-[var(--primary)]" />
              {t("dashboard.availableCc")}
            </span>
            <div className="text-right">
              {loading ? (
                <span className="text-sm text-[var(--muted-foreground)]">…</span>
              ) : (
                <div className="flex items-baseline justify-end gap-2">
                  <span className="text-base font-bold tabular-nums text-[var(--foreground)]">
                    {formatCc(available)}
                  </span>
                  {availableUsd !== null && (
                    <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                      ${formatUsd(availableUsd)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Locked row */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <Lock className="h-3 w-3 text-canton" />
              {t("dashboard.lockedCc")}
            </span>
            <div className="text-right">
              {loading ? (
                <span className="text-sm text-[var(--muted-foreground)]">…</span>
              ) : (
                <div className="flex items-baseline justify-end gap-2">
                  <span className="text-base font-bold tabular-nums text-[var(--foreground)]">
                    {formatCc(locked)}
                  </span>
                  {lockedUsd !== null && (
                    <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                      ${formatUsd(lockedUsd)}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Allocation bar ── */}
        <div className="mt-5">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--primary)] to-[rgb(var(--canton-cyan-rgb))]"
              style={{ width: `${Math.max(0, 100 - lockedPct)}%` }}
            />
            <div
              className="absolute inset-y-0 rounded-full bg-gradient-to-r from-[rgb(var(--canton-rgb)/0.4)] to-[var(--primary)]"
              style={{ left: `${100 - lockedPct}%`, width: `${lockedPct}%` }}
            />
          </div>
          <p className="mt-2 text-right text-[11px] font-medium tabular-nums text-[var(--muted-foreground)]">
            {lockedPct}% locked
          </p>
        </div>
      </div>
    </Card>
  );
}
