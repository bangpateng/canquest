"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { useCcPrice } from "@/lib/hooks/use-cc-price";
import { isRealCantonPartyId } from "@/lib/auth/wallet-session-cache";
import { ROUTES } from "@/lib/routing/app-routes";
import { TokenCard } from "./token-card";

interface TokenListProps {
  me: { username?: string | null; cantonPartyId?: string | null };
  onRefresh?: () => void;
}

interface SwapToken {
  instrumentId: string;
  instrumentAdmin: string;
  isCC?: boolean;
}

interface BalancesResponse {
  cc: number;
  tokens: Record<string, string>;
}

/**
 * Main wallet view — daftar SEMUA kartu token (CC + semua token Cantex).
 *
 * CC saldo dari useCcBalance (on-chain). Token non-CC saldo dari
 * /api/party/swap/balances (off-chain custody). Klik → detail view.
 */
export function TokenList({ me, onRefresh }: TokenListProps) {
  const router = useRouter();
  const hasWallet = isRealCantonPartyId(me.cantonPartyId);

  const {
    balance: ccBalance,
    loading: ccLoading,
    refresh: fetchCcBalance,
  } = useCcBalance({ enabled: hasWallet, pollIntervalMs: 90_000 });

  const { price: ccUsdPrice, change24hPct } = useCcPrice();
  const ccUsd = ccUsdPrice ?? 0;

  // Token list dari Cantex pools + saldo off-chain.
  const [swapTokens, setSwapTokens] = useState<SwapToken[]>([]);
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {},
  );
  const [tokensLoading, setTokensLoading] = useState(false);

  const loadTokens = useCallback(async () => {
    setTokensLoading(true);
    try {
      const [poolsRes, balRes] = await Promise.all([
        fetch("/api/party/swap/pools", { credentials: "include" }),
        fetch("/api/party/swap/balances", { credentials: "include" }),
      ]);
      if (poolsRes.ok) {
        const data = (await poolsRes.json()) as { tokens?: SwapToken[] };
        setSwapTokens(data.tokens ?? []);
      }
      if (balRes.ok) {
        const bal = (await balRes.json()) as BalancesResponse;
        setTokenBalances(bal.tokens ?? {});
      }
    } catch {
      /* non-fatal — token cards tetap render pakai saldo 0 */
    } finally {
      setTokensLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasWallet) void loadTokens();
  }, [hasWallet, loadTokens]);

  const handleRefresh = useCallback(() => {
    void fetchCcBalance();
    void loadTokens();
    onRefresh?.();
  }, [fetchCcBalance, loadTokens, onRefresh]);

  const ccFiat =
    !ccLoading && ccUsd > 0 && ccBalance !== null
      ? `$${(ccBalance * ccUsd).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : undefined;

  return (
    <div className="w-full max-w-full min-w-0 space-y-4 font-sans">
      {/* Header + refresh */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-white">Tokens</h2>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={ccLoading || tokensLoading}
          className="rounded-xl p-2.5 text-slate-400 transition-all duration-200 hover:bg-white/[0.06] hover:text-slate-100 disabled:opacity-40"
          aria-label="Refresh"
        >
          {ccLoading || tokensLoading ? (
            <LoadingSpinner size="sm" tone="muted" />
          ) : (
            <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5" />
          )}
        </button>
      </div>

      {/* Token cards */}
      <div className="space-y-3">
        {/* CC card (always first, on-chain balance) */}
        <TokenCard
          symbol="Amulet"
          balance={
            ccLoading ? "—" : (ccBalance?.toFixed(4) ?? "0.0000")
          }
          fiatValue={ccFiat}
          change24hPct={change24hPct ?? undefined}
          onClick={() => router.push(ROUTES.walletToken("cc"))}
        />

        {/* Non-CC tokens from Cantex pools */}
        {swapTokens
          .filter((t) => !t.isCC)
          .map((t) => {
            const key = `${t.instrumentId}::${t.instrumentAdmin}`;
            const bal = parseFloat(tokenBalances[key] ?? "0");
            return (
              <TokenCard
                key={key}
                symbol={t.instrumentId}
                balance={bal.toFixed(4)}
                onClick={() =>
                  router.push(
                    ROUTES.walletToken(
                      t.instrumentId.toLowerCase().replace(/[^a-z0-9]/g, "-"),
                    ),
                  )
                }
              />
            );
          })}
      </div>
    </div>
  );
}
