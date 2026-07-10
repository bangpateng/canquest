"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCcBalance } from "@/lib/hooks/use-cc-balance";
import { useCcPrice } from "@/lib/hooks/use-cc-price";
import { isRealCantonPartyId } from "@/lib/auth/wallet-session-cache";
import { formatPartyIdForDisplay } from "@/lib/canton/canton-party-id";
import { ROUTES } from "@/lib/routing/app-routes";
import { WalletActions } from "./wallet-actions";
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
 * Main wallet view — Wintip-style layout:
 *   1. Balance hero (total CC value)
 *   2. Actions (Send / Receive / Offers / Swap)
 *   3. My Tokens list (CC + all Cantex tokens)
 *
 * Klik token card → detail view /wallet/<tokenId>.
 */
export function TokenList({ me, onRefresh }: TokenListProps) {
  const router = useRouter();
  const hasWallet = isRealCantonPartyId(me.cantonPartyId);
  const displayPartyId = formatPartyIdForDisplay(me.cantonPartyId);

  const {
    balance: ccBalance,
    loading: ccLoading,
    refresh: fetchCcBalance,
    refreshWithRetries,
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
    refreshWithRetries();
    void loadTokens();
    onRefresh?.();
  }, [refreshWithRetries, loadTokens, onRefresh]);

  const ccFiat =
    !ccLoading && ccUsd > 0 && ccBalance !== null
      ? (ccBalance * ccUsd).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null;

  return (
    <div className="w-full max-w-full min-w-0 space-y-5 md:space-y-6 font-sans">
      {/* ── Balance Hero Card ───────────────────────────────────────────── */}
      <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 p-6 sm:p-8 md:p-10 lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgb(var(--canton-rgb)/0.10),transparent_70%)]"
          aria-hidden
        />
        <div className="relative flex items-center justify-between gap-3 mb-6 sm:mb-8">
          <div className="flex items-center gap-3">
            <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
              Balance
            </span>
            {ccUsd > 0 && (
              <span className="inline-block text-[10px] sm:text-xs font-semibold tracking-wider text-[var(--primary)]">
                1 CC ≈ ${ccUsd.toFixed(6)}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void fetchCcBalance()}
            disabled={ccLoading}
            className="rounded-xl p-2.5 text-slate-400 transition-all duration-200 hover:bg-white/[0.06] hover:text-slate-100 disabled:opacity-40"
            aria-label="Refresh balance"
          >
            {ccLoading ? (
              <LoadingSpinner size="sm" tone="muted" />
            ) : (
              <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5" />
            )}
          </button>
        </div>

        <div className="relative">
          <p className="relative text-3xl font-extrabold tabular-nums leading-none tracking-tight text-white sm:text-4xl md:text-5xl">
            {ccLoading ? (
              <span className="text-slate-500">—</span>
            ) : (
              <>
                {ccBalance?.toFixed(4) ?? "0.0000"}{" "}
                <span className="text-base font-semibold text-slate-500 sm:text-lg md:text-xl">
                  CC
                </span>
              </>
            )}
          </p>
          {!ccLoading && ccUsd > 0 && ccBalance !== null ? (
            <p className="relative mt-4 text-sm font-medium text-slate-500 sm:mt-5 sm:text-base md:text-lg">
              ≈ ${ccFiat} USD
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Actions ── */}
      <WalletActions
        partyId={displayPartyId}
        balance={ccBalance}
        onBalanceRefresh={handleRefresh}
      />

      {/* ── My Tokens ──────────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            My Tokens
          </h2>
          {tokensLoading && (
            <LoadingSpinner size="sm" tone="muted" />
          )}
        </div>
        <div className="space-y-3">
          {/* CC card (always first) */}
          <TokenCard
            symbol="Amulet"
            balance={
              ccLoading ? "—" : (ccBalance?.toFixed(4) ?? "0.0000")
            }
            fiatValue={ccFiat ? `$${ccFiat}` : undefined}
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
                        t.instrumentId
                          .toLowerCase()
                          .replace(/[^a-z0-9]/g, "-"),
                      ),
                    )
                  }
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}
