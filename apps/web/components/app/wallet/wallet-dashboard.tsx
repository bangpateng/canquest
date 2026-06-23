"use client";

import { useEffect, useState, useCallback } from "react";
import { CopyField } from "@/components/app/wallet/copy-field";
import { WalletActions } from "@/components/app/wallet/wallet-actions";
import { CcLockModal } from "@/components/app/wallet/cc-lock-modal";
import { OffersSection } from "@/components/app/wallet/offers-section";
import { TransactionsView } from "@/components/app/wallet/transactions-view";
import { RefreshCw, Lock } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { useLockStatus } from "@/lib/hooks/use-lock-status";
import { formatPartyIdForDisplay } from "@/lib/canton/canton-party-id";
import { isRealCantonPartyId } from "@/lib/auth/wallet-session-cache";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils/utils";

interface WalletDashboardProps {
  me: { username?: string | null; cantonPartyId?: string | null };
  onRefresh?: () => void;
}

/** tierLabel: FULL → "Full access" (hijau), SPIN → "Spin only" (kuning). */
function tierBadge(tier: "NONE" | "SPIN" | "FULL") {
  if (tier === "FULL") return { label: "Full access", color: "text-emerald-400" };
  if (tier === "SPIN") return { label: "Spin only", color: "text-amber-400" };
  return { label: "", color: "text-slate-400" };
}

export function WalletDashboard({ me, onRefresh }: WalletDashboardProps) {
  const t = usePlatformT();
  const hasWallet = isRealCantonPartyId(me.cantonPartyId);
  const displayPartyId = formatPartyIdForDisplay(me.cantonPartyId);
  const {
    balance,
    loading: balanceLoading,
    refresh: fetchBalance,
    refreshWithRetries,
  } = useCcBalance({ enabled: hasWallet, pollIntervalMs: 45_000 });
  const {
    status: lockStatus,
    refreshWithRetries: refreshLock,
  } = useLockStatus({ enabled: hasWallet, pollIntervalMs: 60_000 });
  const [ccUsdPrice, setCcUsdPrice] = useState(0);
  const [txRefreshKey, setTxRefreshKey] = useState(0);
  const [lockOpen, setLockOpen] = useState(false);

  useEffect(() => {
    const pollPrice = () => {
      fetch("/api/party/cc-price", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { lastPrice?: number | null } | null) => {
          if (d?.lastPrice) setCcUsdPrice(d.lastPrice);
        })
        .catch(() => {});
    };
    pollPrice();
    const interval = setInterval(pollPrice, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleBalanceRefresh = useCallback(() => {
    refreshWithRetries();
    setTxRefreshKey((k) => k + 1);
    onRefresh?.();
  }, [refreshWithRetries, onRefresh]);

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden space-y-5 md:space-y-6 font-sans">
      {/* ── Balance Hero Card ───────────────────────────────────────────── */}
      <div className="relative w-full max-w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 p-6 sm:p-8 md:p-10 lg:p-12">
        {/* Ambient glow */}
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgb(var(--canton-rgb)/0.10),transparent_70%)]"
          aria-hidden
        />
        <div className="relative flex items-center justify-between gap-3 mb-6 sm:mb-8">
          <div className="flex items-center gap-3">
            <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
              {t("wallet.balance")}
            </span>
            {ccUsdPrice > 0 && (
              <span className="inline-block text-[10px] sm:text-xs font-semibold tracking-wider text-[var(--primary)]">
                1 CC ≈ ${ccUsdPrice.toFixed(6)}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void fetchBalance()}
            disabled={balanceLoading}
            className="rounded-xl p-2.5 text-slate-400 transition-all duration-200 hover:bg-white/[0.06] hover:text-slate-100 disabled:opacity-40"
            aria-label={t("wallet.refreshBalance")}
          >
            {balanceLoading ? (
              <LoadingSpinner size="sm" tone="muted" />
            ) : (
              <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5" />
            )}
          </button>
        </div>

        <div className="relative">
          <p className="relative text-3xl font-extrabold tabular-nums leading-none tracking-tight text-white sm:text-4xl md:text-5xl glow-text">
            {balanceLoading ? (
              <span className="text-slate-500">—</span>
            ) : (
              <>
                {balance?.toFixed(4) ?? "0.0000"}{" "}
                <span className="text-base font-semibold text-slate-500 sm:text-lg md:text-xl">
                  CC
                </span>
              </>
            )}
          </p>
          {!balanceLoading && ccUsdPrice > 0 && balance !== null ? (
            <p className="relative mt-4 text-sm font-medium text-slate-500 sm:mt-5 sm:text-base md:text-lg">
              ≈ $
              {(balance * ccUsdPrice).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              USD
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Lock status bar (satu baris tipis) ── */}
      {hasWallet && lockStatus.hasWallet && (
        <LockStatusBar status={lockStatus} onManage={() => setLockOpen(true)} />
      )}

      <WalletActions
        partyId={displayPartyId}
        balance={balance}
        onBalanceRefresh={handleBalanceRefresh}
      />

      <OffersSection onRefresh={handleBalanceRefresh} />

      <TransactionsView variant="embedded" refreshKey={txRefreshKey} partyId={me.cantonPartyId ?? null} />

      {/* ── Lock modal (bottom-sheet) — dimiliki dashboard ── */}
      <CcLockModal
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        status={lockStatus}
        onRefresh={refreshLock}
      />
    </div>
  );
}

/**
 * Satu baris status lock (Spec BAGIAN 5a).
 * - Ada lock aktif: "Terkunci {n} CC · {tierLabel}" + tombol "Kelola".
 * - Tidak ada lock: ajakan "Belum ada CC terkunci · kunci untuk ikut Earn" + tombol "Lock".
 * Aksen hijau-outline (bukan hijau penuh). Satu-satunya pintu masuk modal Lock di halaman wallet.
 */
function LockStatusBar({
  status,
  onManage,
}: {
  status: { lockedCc: number; tier: "NONE" | "SPIN" | "FULL" };
  onManage: () => void;
}) {
  const hasLock = status.lockedCc > 0;
  const badge = tierBadge(status.tier);

  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Lock className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
        {hasLock ? (
          <span className="truncate text-slate-200">
            Locked <span className="font-semibold">{status.lockedCc} CC</span>
            {badge.label && (
              <span className={cn("ml-1.5 font-medium", badge.color)}>· {badge.label}</span>
            )}
          </span>
        ) : (
          <span className="truncate text-slate-400">
            No CC locked
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onManage}
        className="shrink-0 rounded-xl border border-emerald-500/60 bg-transparent px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-all hover:bg-emerald-500/10"
      >
        {hasLock ? "Manage" : "Lock"}
      </button>
    </div>
  );
}
