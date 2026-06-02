"use client";

import { useEffect, useState, useCallback } from "react";
import { CopyField } from "@/components/app/wallet/copy-field";
import { WalletActions } from "@/components/app/wallet/wallet-actions";
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
    <div className="w-full max-w-full min-w-0 space-y-6 md:space-y-8">
      {/* Wallet Status Card */}
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/[0.05] bg-slate-900/70 p-5 backdrop-blur-xl shadow-2xl shadow-black/40 sm:p-6 md:p-8 lg:p-10">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 sm:text-sm">
            {t("wallet.walletActive")}
          </p>
        </div>
        <div className="mt-5 sm:mt-6">
          <CopyField
            label={t("wallet.partyId")}
            value={hasWallet ? displayPartyId || "—" : "—"}
          />
        </div>
      </div>

      {/* Balance Card - Premium glassmorphic design */}
      <div className="w-full max-w-full overflow-hidden rounded-3xl border border-white/[0.05] bg-slate-900/70 p-5 backdrop-blur-xl shadow-2xl shadow-black/40 sm:p-6 md:p-8 lg:p-10">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 sm:text-sm">
            {t("wallet.balance")}
          </p>
          <button
            type="button"
            onClick={() => void fetchBalance()}
            disabled={balanceLoading}
            className="rounded-xl p-2 text-slate-400 transition-all hover:bg-white/[0.04] hover:text-slate-100 disabled:opacity-40"
            aria-label={t("wallet.refreshBalance")}
          >
            {balanceLoading ? (
              <LoadingSpinner size="sm" tone="muted" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-4 text-4xl font-bold tabular-nums leading-none tracking-tight text-white sm:mt-5 sm:text-5xl md:text-6xl lg:text-7xl">
          {balanceLoading ? (
            <span className="text-slate-500">—</span>
          ) : (
            <>
              {balance?.toFixed(4) ?? "0.0000"}{" "}
              <span className="text-xl font-semibold text-slate-500 sm:text-2xl md:text-3xl">
                CC
              </span>
            </>
          )}
        </p>
        {!balanceLoading && ccUsdPrice > 0 && balance !== null ? (
          <p className="mt-3 text-sm font-medium text-slate-500 sm:mt-4 sm:text-base">
            ≈ $
            {(balance * ccUsdPrice).toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            USD
          </p>
        ) : null}
      </div>

      <WalletPreapprovalBanner onActivated={handleBalanceRefresh} />

      <WalletActions
        partyId={displayPartyId}
        onBalanceRefresh={handleBalanceRefresh}
      />

      <TransactionsView variant="embedded" refreshKey={txRefreshKey} />
    </div>
  );
}
