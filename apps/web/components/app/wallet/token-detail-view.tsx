"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCw, Lock } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { useCcPrice } from "@/lib/hooks/use-cc-price";
import { useLockStatus } from "@/lib/hooks/use-lock-status";
import { formatPartyIdForDisplay } from "@/lib/canton/canton-party-id";
import { isRealCantonPartyId } from "@/lib/auth/wallet-session-cache";
import { cn } from "@/lib/utils/utils";
import { WalletActions } from "./wallet-actions";
import { CcLockModal } from "./cc-lock-modal";
import { TransactionsView } from "./transactions-view";
import { TokenLogo, displayName } from "./token-logo";

interface SwapToken {
  instrumentId: string;
  instrumentAdmin: string;
  isCC?: boolean;
}

interface TokenDetailViewProps {
  tokenId: string;
  me: { username?: string | null; cantonPartyId?: string | null };
}

/**
 * Detail view untuk token yang dipilih (/wallet/<tokenId>).
 *
 * tokenId === "cc": balance hero + Send/Receive/Swap + Lock + Activity history.
 * tokenId lain (Phase 2): balance + Swap saja (Send/Receive non-CC belum ada).
 */
export function TokenDetailView({ tokenId, me }: TokenDetailViewProps) {
  const router = useRouter();
  const isCC = tokenId.toLowerCase() === "cc";
  const hasWallet = isRealCantonPartyId(me.cantonPartyId);
  const displayPartyId = formatPartyIdForDisplay(me.cantonPartyId);

  // CC-specific hooks (hanya fetch untuk CC).
  const {
    balance,
    loading: balanceLoading,
    refresh: fetchBalance,
    refreshWithRetries,
  } = useCcBalance({ enabled: hasWallet && isCC, pollIntervalMs: 90_000 });
  const {
    status: lockStatus,
    refreshWithRetries: refreshLock,
  } = useLockStatus({ enabled: hasWallet && isCC, pollIntervalMs: 120_000 });
  const { price: ccUsdPrice } = useCcPrice();
  const ccUsd = ccUsdPrice ?? 0;

  const [txRefreshKey, setTxRefreshKey] = useState(0);
  const [lockOpen, setLockOpen] = useState(false);

  // Non-CC token: resolve instrument asli + saldo off-chain.
  const [tokenInfo, setTokenInfo] = useState<SwapToken | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number>(0);

  useEffect(() => {
    if (isCC) return;
    let cancelled = false;
    void (async () => {
      try {
        const [poolsRes, balRes] = await Promise.all([
          fetch("/api/party/swap/pools", { credentials: "include" }),
          fetch("/api/party/swap/balances", { credentials: "include" }),
        ]);
        if (poolsRes.ok) {
          const data = (await poolsRes.json()) as { tokens?: SwapToken[] };
          // Match tokenId (lowercase) ke instrumentId asli (case-sensitive).
          const found = (data.tokens ?? []).find(
            (t) =>
              t.instrumentId.toLowerCase().replace(/[^a-z0-9]/g, "-") ===
              tokenId,
          );
          if (!cancelled && found) setTokenInfo(found);
        }
        if (balRes.ok && tokenInfo) {
          const bal = (await balRes.json()) as {
            tokens: Record<string, string>;
          };
          const key = `${tokenInfo.instrumentId}::${tokenInfo.instrumentAdmin}`;
          if (!cancelled)
            setTokenBalance(parseFloat(bal.tokens[key] ?? "0"));
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCC, tokenId, tokenInfo]);

  const handleBalanceRefresh = useCallback(() => {
    refreshWithRetries();
    setTxRefreshKey((k) => k + 1);
  }, [refreshWithRetries]);

  const handleLockAction = useCallback(() => {
    refreshLock();
    refreshWithRetries();
    setTxRefreshKey((k) => k + 1);
  }, [refreshLock, refreshWithRetries]);

  // Token display info.
  const symbol = isCC ? "Amulet" : (tokenInfo?.instrumentId ?? tokenId);
  const display = displayName(symbol);
  const displayBalance = isCC
    ? (balance?.toFixed(4) ?? "0.0000")
    : tokenBalance.toFixed(4);
  const usdValue =
    isCC && !balanceLoading && ccUsd > 0 && balance !== null
      ? (balance * ccUsd).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null;

  return (
    <div className="w-full max-w-full min-w-0 space-y-4 font-sans">
      {/* ── Header bar: back + title ── */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push("/wallet")}
          className="flex items-center gap-2 text-sm font-medium text-slate-400 transition hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Wallet
        </button>
        <button
          type="button"
          onClick={() => void fetchBalance()}
          disabled={balanceLoading}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100 disabled:opacity-40"
          aria-label="Refresh balance"
        >
          {balanceLoading ? (
            <LoadingSpinner size="sm" tone="muted" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* ── Token header: logo + name + balance (compact, inline) ── */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <TokenLogo symbol={symbol} size="md" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold text-slate-100">{display}</h1>
            <p className="text-xl font-bold tabular-nums text-white sm:text-2xl">
              {balanceLoading && isCC ? (
                <span className="text-slate-500">—</span>
              ) : (
                <>
                  {displayBalance}{" "}
                  <span className="text-sm font-medium text-slate-500">
                    {display}
                  </span>
                </>
              )}
            </p>
          </div>
          {usdValue && (
            <div className="text-right">
              <span className="text-xs text-slate-500">≈</span>{" "}
              <span className="text-sm font-semibold tabular-nums text-slate-300">
                ${usdValue}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Actions ── */}
      {isCC ? (
        <>
          {/* Lock status bar */}
          {hasWallet && lockStatus.hasWallet && (
            <LockStatusBar status={lockStatus} onManage={() => setLockOpen(true)} />
          )}

          <WalletActions
            partyId={displayPartyId}
            balance={balance}
            onBalanceRefresh={handleBalanceRefresh}
          />

          {/* Activity history — CC only */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Activity
            </h2>
            <TransactionsView
              variant="embedded"
              refreshKey={txRefreshKey}
              partyId={me.cantonPartyId ?? null}
            />
          </div>

          {/* Lock modal */}
          <CcLockModal
            open={lockOpen}
            onClose={() => setLockOpen(false)}
            status={lockStatus}
            onRefresh={handleLockAction}
          />
        </>
      ) : (
        <div className="rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 p-4 text-center">
          <p className="text-sm text-slate-400">
            Swap {display} dari menu Swap di halaman utama wallet.
          </p>
        </div>
      )}
    </div>
  );
}

/** Lock status bar (dipindah dari wallet-dashboard). */
function LockStatusBar({
  status,
  onManage,
}: {
  status: { lockedCc: number; tier: "NONE" | "FULL" };
  onManage: () => void;
}) {
  const hasLock = status.lockedCc > 0;
  const badge =
    status.tier === "FULL"
      ? { label: "Full access", color: "text-emerald-400" }
      : { label: "", color: "text-slate-400" };

  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.04] px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Lock className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
        {hasLock ? (
          <span className="truncate text-slate-200">
            Locked{" "}
            <span className="font-semibold">{status.lockedCc} CC</span>
            {badge.label && (
              <span className={cn("ml-1.5 font-medium", badge.color)}>
                · {badge.label}
              </span>
            )}
          </span>
        ) : (
          <span className="truncate text-slate-400">No CC locked</span>
        )}
      </div>
      <button
        type="button"
        onClick={onManage}
        className="shrink-0 rounded-xl border border-emerald-500/60 bg-transparent px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/10"
      >
        {hasLock ? "Manage" : "Lock"}
      </button>
    </div>
  );
}
