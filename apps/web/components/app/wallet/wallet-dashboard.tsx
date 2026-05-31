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
    <div className="w-full min-w-0 space-y-8">
      <div className="glass-card w-full min-w-0 rounded-3xl border border-white/5 p-8">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {t("wallet.walletActive")}
          </p>
        </div>
        <div className="mt-4">
          <CopyField
            label={t("wallet.partyId")}
            value={hasWallet ? displayPartyId || "—" : "—"}
          />
        </div>
      </div>

      <div className="glass-card w-full min-w-0 rounded-3xl border border-white/5 p-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {t("wallet.balance")}
          </p>
          <button
            type="button"
            onClick={() => void fetchBalance()}
            disabled={balanceLoading}
            className="text-slate-400 transition-colors hover:text-slate-100 disabled:opacity-40"
            aria-label={t("wallet.refreshBalance")}
          >
            {balanceLoading ? (
              <LoadingSpinner size="sm" tone="muted" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums leading-none text-slate-100">
          {balanceLoading ? (
            <span className="text-slate-400">—</span>
          ) : (
            <>
              {balance?.toFixed(4) ?? "0.0000"}{" "}
              <span className="text-xl font-semibold text-slate-400">
                CC
              </span>
            </>
          )}
        </p>
        {!balanceLoading && ccUsdPrice > 0 && balance !== null ? (
          <p className="mt-2 text-sm font-medium text-slate-400">
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
