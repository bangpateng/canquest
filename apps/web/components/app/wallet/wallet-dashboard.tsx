"use client";

import { useEffect, useState, useCallback } from "react";
import { CopyField } from "@/components/app/wallet/copy-field";
import { WalletActions } from "@/components/app/wallet/wallet-actions";
import { TransactionsView } from "@/components/app/wallet/transactions-view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { formatPartyIdForDisplay } from "@/lib/canton/canton-party-id";
import { isRealCantonPartyId } from "@/lib/auth/wallet-session-cache";
import { usePlatformT } from "@/lib/i18n/platform-provider";

interface WalletDashboardProps { me: { username?: string | null; cantonPartyId?: string | null }; onRefresh?: () => void; }

export function WalletDashboard({ me, onRefresh }: WalletDashboardProps) {
  const t = usePlatformT();
  const hasWallet = isRealCantonPartyId(me.cantonPartyId);
  const displayPartyId = formatPartyIdForDisplay(me.cantonPartyId);
  const { balance, loading: bl, refresh: fb, refreshWithRetries } = useCcBalance({ enabled: hasWallet, pollIntervalMs: 45000 });
  const [price, setPrice] = useState(0);
  const [tk, setTk] = useState(0);

  useEffect(() => { fetch("/api/party/fee-config", { credentials: "include" }).then(r => r.ok ? r.json() : null).then((d: any) => { if (d?.ccUsdPrice) setPrice(d.ccUsdPrice); }).catch(() => {}); }, []);

  const hb = useCallback(() => { refreshWithRetries(); setTk(k => k + 1); onRefresh?.(); }, [refreshWithRetries, onRefresh]);

  return (
    <div className="w-full max-w-full min-w-0 space-y-4 md:space-y-5">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs font-medium text-[var(--muted-foreground)]">{t("wallet.walletActive")}</span>
        </div>
        <CopyField label={t("wallet.partyId")} value={hasWallet ? displayPartyId || "\u2014" : "\u2014"} />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 md:p-6 lg:p-8">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">{t("wallet.balance")}</span>
          <button type="button" onClick={() => void fb()} disabled={bl} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40">{bl ? <LoadingSpinner size="sm" /> : "Refresh"}</button>
        </div>
        <p className="text-3xl font-bold tabular-nums text-[var(--foreground)] md:text-4xl">{bl ? "\u2014" : <>{balance?.toFixed(4) ?? "0.0000"} <span className="text-base font-semibold text-[var(--muted-foreground)]">CC</span></>}</p>
        {!bl && price > 0 && balance !== null && <p className="mt-2 text-xs text-[var(--muted-foreground)]">\u2248 ${(balance * price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</p>}
      </div>

      <WalletActions partyId={displayPartyId} onBalanceRefresh={hb} />
      <TransactionsView variant="embedded" refreshKey={tk} />
    </div>
  );
}