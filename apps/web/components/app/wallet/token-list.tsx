"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTokenPrices } from "@/lib/hooks/use-token-prices";
import { isRealCantonPartyId } from "@/lib/auth/wallet-session-cache";
import { formatPartyIdForDisplay } from "@/lib/canton/canton-party-id";

/**
 * Token yang SUDAH aktif untuk swap (selain CC).
 * Token lain tampil "Coming Soon" sampai di-enable bertahap.
 */
const ACTIVE_SWAP_TOKENS = new Set(["USDCX"]);

/** Cek apakah token ini aktif untuk swap/detail. CC selalu aktif. */
function isTokenActive(symbol: string, isCC?: boolean): boolean {
  if (isCC) return true;
  return ACTIVE_SWAP_TOKENS.has(symbol.toUpperCase());
}
import { WalletActions } from "./wallet-actions";
import { TokenCard } from "./token-card";
import { CcLockModal } from "./cc-lock-modal";
import { useLockStatus } from "@/lib/hooks/use-lock-status";

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
  const hasWallet = isRealCantonPartyId(me.cantonPartyId);
  const displayPartyId = formatPartyIdForDisplay(me.cantonPartyId);

  // Harga semua token dari Cantex DEX (rate vs USDCx = USD anchor).
  const { prices: tokenPrices } = useTokenPrices();

  // Token list + SEMUA saldo (CC + non-CC) dari satu endpoint swap/balances.
  const [swapTokens, setSwapTokens] = useState<SwapToken[]>([]);
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>(
    {},
  );
  const [ccBalance, setCcBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Lock CC — status bar + modal di /wallet utama (sebelumnya di /wallet/cc).
  // Hook enabled hanya kalau user punya wallet (mirror pattern token-detail-view).
  const {
    status: lockStatus,
    refreshWithRetries: refreshLock,
  } = useLockStatus({ enabled: hasWallet, pollIntervalMs: 120_000 });
  const [lockOpen, setLockOpen] = useState(false);

  // CC price: cari "Amulet::admin" di price map (setelah swapTokens load).
  const ccInstrumentKey = swapTokens.find((t) => t.isCC);
  const ccKey = ccInstrumentKey
    ? `${ccInstrumentKey.instrumentId}::${ccInstrumentKey.instrumentAdmin}`
    : null;
  const ccUsd = ccKey ? tokenPrices[ccKey] ?? 0 : 0;

  const loadTokens = useCallback(async () => {
    setLoading(true);
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
        setCcBalance(bal.cc ?? 0);
      }
    } catch {
      /* non-fatal — token cards tetap render pakai saldo 0 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasWallet) void loadTokens();
  }, [hasWallet, loadTokens]);

  const handleRefresh = useCallback(() => {
    void loadTokens();
    onRefresh?.();
  }, [loadTokens, onRefresh]);

  // Total USD value = CC value + semua token non-CC value (Cantex prices).
  const ccValue = ccUsd > 0 && ccBalance !== null ? ccBalance * ccUsd : 0;
  let tokenNonCcValue = 0;
  for (const t of swapTokens) {
    if (t.isCC) continue;
    const key = `${t.instrumentId}::${t.instrumentAdmin}`;
    const price = tokenPrices[key];
    const bal = parseFloat(tokenBalances[key] ?? "0");
    if (price && bal > 0) tokenNonCcValue += bal * price;
  }
  const totalUsd = ccValue + tokenNonCcValue;
  const totalUsdStr = totalUsd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const ccFiatStr = ccValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <div className="w-full max-w-full min-w-0 space-y-5 md:space-y-6 font-sans">
      {/* ── Balance Hero Card ───────────────────────────────────────────── */}
      <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50 p-6 sm:p-8 md:p-10 lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgb(var(--canton-rgb)/0.10),transparent_70%)]"
          aria-hidden
        />
        <div className="relative flex items-center justify-between gap-3 mb-6 sm:mb-8">
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            Total Balance
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="rounded-xl p-2.5 text-slate-400 transition-all duration-200 hover:bg-white/[0.06] hover:text-slate-100 disabled:opacity-40"
            aria-label="Refresh balance"
          >
            {loading ? (
              <LoadingSpinner size="sm" tone="muted" />
            ) : (
              <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5" />
            )}
          </button>
        </div>

        <div className="relative">
          <p className="relative text-3xl font-extrabold tabular-nums leading-none tracking-tight text-white sm:text-4xl md:text-5xl glow-text">
            {loading ? (
              <span className="text-slate-500">—</span>
            ) : (
              <>
                ${totalUsdStr}{" "}
                <span className="text-base font-semibold text-slate-500 sm:text-lg md:text-xl">
                  USD
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* ── Actions ── */}
      <WalletActions
        partyId={displayPartyId}
        balance={ccBalance}
        onBalanceRefresh={handleRefresh}
        onLockClick={() => setLockOpen(true)}
        lockedCc={lockStatus.lockedCc}
      />

      {/* ── Lock modal (CC) — mount di /wallet utama ── */}
      <CcLockModal
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        status={lockStatus}
        onRefresh={() => {
          refreshLock();
          handleRefresh();
        }}
      />

      {/* ── My Tokens ──────────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            My Tokens
          </h2>
          {loading && (
            <LoadingSpinner size="sm" tone="muted" />
          )}
        </div>
        <div className="space-y-3">
          {/* CC card (always first) — display-only */}
          <TokenCard
            symbol="Amulet"
            balance={
              loading ? "—" : (ccBalance?.toFixed(4) ?? "0.0000")
            }
            fiatValue={ccValue > 0 ? `$${ccFiatStr}` : undefined}
          />

          {/* Non-CC tokens — only active ones (display-only, no nav) */}
          {swapTokens
            .filter(
              (t) => !t.isCC && isTokenActive(t.instrumentId, t.isCC),
            )
            .map((t) => {
              const key = `${t.instrumentId}::${t.instrumentAdmin}`;
              const bal = parseFloat(tokenBalances[key] ?? "0");
              const price = tokenPrices[key];
              const fiat =
                price && bal > 0
                  ? `$${(bal * price).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`
                  : undefined;
              return (
                <TokenCard
                  key={key}
                  symbol={t.instrumentId}
                  balance={bal.toFixed(4)}
                  fiatValue={fiat}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}
