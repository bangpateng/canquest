"use client";

import { useEffect, useState, useCallback } from "react";
import { CopyField } from "@/components/app/wallet/copy-field";
import { WalletActions } from "@/components/app/wallet/wallet-actions";
import { WalletPendingOffers } from "@/components/app/wallet/wallet-pending-offers";
import { WalletPreapprovalBanner } from "@/components/app/wallet/wallet-preapproval-banner";
import { TransactionsView } from "@/components/app/wallet/transactions-view";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { formatPartyIdForDisplay } from "@/lib/canton/canton-party-id";
import { isRealCantonPartyId } from "@/lib/auth/wallet-session-cache";
import { usePlatformT } from "@/lib/i18n/platform-provider";

interface WalletDashboardProps {
  me: { username?: string | null; cantonPartyId?: string | null };
  onRefresh?: () => void;
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
  const [ccUsdPrice, setCcUsdPrice] = useState(0);
  const [txRefreshKey, setTxRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/party/fee-config", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ccUsdPrice?: number } | null) => {
        if (d?.ccUsdPrice) setCcUsdPrice(d.ccUsdPrice);
      })
      .catch(() => {});
  }, []);

  const handleBalanceRefresh = useCallback(() => {
    refreshWithRetries();
    setTxRefreshKey((k) => k + 1);
    onRefresh?.();
  }, [refreshWithRetries, onRefresh]);

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden space-y-5 md:space-y-6 font-sans">
      {/* Wallet Status Card */}
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-5 sm:p-6 md:p-8">
        <div className="flex items-center gap-3 mb-5 sm:mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
          </div>
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            {t("wallet.walletActive")}
          </span>
        </div>
        <div>
          <CopyField
            label={t("wallet.partyId")}
            value={hasWallet ? displayPartyId || "\u2014" : "\u2014"}
          />
        </div>
      </div>

      {/* Balance Card — Hero Bento Feature */}
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/5 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40 p-6 sm:p-8 md:p-10 lg:p-12">
        <div className="flex items-center justify-between gap-3 mb-6 sm:mb-8">
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            {t("wallet.balance")}
          </span>
          <button
            type="button"
            onClick={() => void fetchBalance()}
            disabled={balanceLoading}
            className="rounded-lg p-2.5 text-slate-400 transition-all duration-200 hover:bg-white/[0.06] hover:text-slate-100 disabled:opacity-40 ring-1 ring-white/10 hover:ring-white/20"
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
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgb(var(--canton-rgb)/0.12),transparent_70%)]"
            aria-hidden
          />
          <p className="relative text-3xl font-extrabold tabular-nums leading-none tracking-tight text-white sm:text-4xl md:text-5xl">
            {balanceLoading ? (
              <span className="text-slate-500">\u2014</span>
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
              \u2248 $
              {(balance * ccUsdPrice).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              USD
            </p>
          ) : null}
        </div>
      </div>

      <WalletPendingOffers onBalanceRefresh={handleBalanceRefresh} />

      <WalletPreapprovalBanner onActivated={handleBalanceRefresh} />

      <WalletActions
        partyId={displayPartyId}
        onBalanceRefresh={handleBalanceRefresh}
      />

      <TransactionsView variant="embedded" refreshKey={txRefreshKey} />
    </div>
  );
}