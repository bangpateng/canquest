"use client";

import { useEffect, useState, useCallback } from "react";
import { CopyField } from "@/components/app/copy-field";
import { WalletActions } from "@/components/app/wallet-actions";
import { WalletPreapprovalBanner } from "@/components/app/wallet-preapproval-banner";
import { TransactionsView } from "@/components/app/transactions-view";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { formatPartyIdForDisplay } from "@/lib/canton-party-id";
import { isRealCantonPartyId } from "@/lib/wallet-session-cache";
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
  } = useCcBalance({ enabled: hasWallet });
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
    <div className="w-full min-w-0 space-y-6">
      <div className="glass-card w-full min-w-0 rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {t("wallet.walletActive")}
          </p>
        </div>
        <div className="mt-3">
          <CopyField
            label={t("wallet.partyId")}
            value={hasWallet ? displayPartyId || "—" : "—"}
          />
        </div>
      </div>

      <div className="glass-card w-full min-w-0 rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            {t("wallet.balance")}
          </p>
          <button
            type="button"
            onClick={() => void fetchBalance()}
            disabled={balanceLoading}
            className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-40"
            aria-label={t("wallet.refreshBalance")}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${balanceLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        <p className="type-stat mt-2">
          {balanceLoading ? (
            <span className="text-[var(--muted-foreground)]">—</span>
          ) : (
            <>
              {balance?.toFixed(4) ?? "0.0000"}{" "}
              <span className="text-lg font-normal text-[var(--muted-foreground)]">
                CC
              </span>
            </>
          )}
        </p>
        {!balanceLoading && ccUsdPrice > 0 && balance !== null ? (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
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
