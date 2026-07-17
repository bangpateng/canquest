"use client";

import { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useTokenPrices } from "@/lib/hooks/use-token-prices";
import {
  usePools,
  useBalances,
  useInvalidateWalletTokens,
} from "@/lib/hooks/use-wallet-tokens";
import {
  isRealCantonPartyId,
} from "@/lib/auth/wallet-session-cache";
import { formatPartyIdForDisplay } from "@/lib/canton/canton-party-id";
import type { WalletToken } from "@/lib/canton/token-types";

/**
 * Token yang ditampilkan di wallet. Hanya CC + USDCx + CBTC — semua token
 * lain (cETH, HANDL, MOD, EDELx, HECTO, FRXUSD, USDC.B, dll) disembunyikan
 * dari UI wallet sampai diaktifkan secara eksplisit di sini.
 *
 * CC selalu muncul (di-render terpisah di atas, hard-coded Amulet).
 * USDCx aktif penuh. CBTC tampil tapi "Coming soon" (belum bisa swap/send).
 */
const VISIBLE_TOKENS = new Set(["USDCX", "CBTC"]);
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

/** Alias lokal — shape identik dengan WalletToken (lib/canton/token-types). */
type SwapToken = WalletToken;

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

  // Token list + SEMUA saldo dari endpoint terpisah, TAPI lewat react-query
  // dengan query key dishared → ter-dedup dengan WalletActions (sebelumnya
  // TokenList & WalletActions masing-masing fetch pools+balances sendiri = 4x
  // request duplikat saat mount /wallet).
  const poolsQuery = usePools({ enabled: hasWallet });
  const balancesQuery = useBalances({ enabled: hasWallet });
  const invalidateWalletTokens = useInvalidateWalletTokens();

  const swapTokens: SwapToken[] = useMemo(
    () => poolsQuery.data?.tokens ?? [],
    [poolsQuery.data],
  );
  const tokenBalances = balancesQuery.data?.tokens ?? {};
  const ccBalance = balancesQuery.data ? balancesQuery.data.cc : null;

  // initialLoad = true hanya saat fetch pertama (belum ada data sama sekali).
  // Background refresh TIDAK flip ini → hero pertahankan nilai lama, bukan "—".
  const initialLoad = poolsQuery.isPending || balancesQuery.isPending;
  // loading dipakai tombol Refresh — true saat ada fetch berjalan (bukan hanya
  // first-load) supaya tombol beri feedback spinner.
  const loading = poolsQuery.isFetching || balancesQuery.isFetching;

  // Lock CC — status bar + modal di /wallet utama (sebelumnya di /wallet/cc).
  // Hook enabled hanya kalau user punya wallet (mirror pattern token-detail-view).
  const {
    status: lockStatus,
    refreshWithRetries: refreshLock,
  } = useLockStatus({ enabled: hasWallet });
  const [lockOpen, setLockOpen] = useState(false);

  // CC price: cari "Amulet::admin" di price map (setelah swapTokens load).
  const ccInstrumentKey = useMemo(
    () => swapTokens.find((t) => t.isCC),
    [swapTokens],
  );
  const ccKey = ccInstrumentKey
    ? `${ccInstrumentKey.instrumentId}::${ccInstrumentKey.instrumentAdmin}`
    : null;
  const ccUsd = ccKey ? tokenPrices[ccKey] ?? 0 : 0;

  const handleRefresh = useCallback(() => {
    void invalidateWalletTokens();
    onRefresh?.();
  }, [invalidateWalletTokens, onRefresh]);

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
            {initialLoad ? (
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
          <span className="inline-block text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
            My Tokens
          </span>
          {loading && (
            <LoadingSpinner size="sm" tone="muted" />
          )}
        </div>
        <div className="space-y-3">
          {/* CC card (always first) — display-only */}
          <TokenCard
            symbol="Amulet"
            balance={
              initialLoad ? "—" : (ccBalance?.toFixed(4) ?? "0.0000")
            }
            fiatValue={ccValue > 0 ? `$${ccFiatStr}` : undefined}
          />

          {/* Non-CC tokens — hanya yang whitelist (USDCx + CBTC). Token lain
              (cETH, HANDL, MOD, EDELx, HECTO, FRXUSD, USDC.B, dll)
              disembunyikan dari UI wallet. */}
          {swapTokens
            .filter(
              (t) => !t.isCC && VISIBLE_TOKENS.has(t.instrumentId.toUpperCase()),
            )
            .map((t) => {
              const key = `${t.instrumentId}::${t.instrumentAdmin}`;
              const active = isTokenActive(t.instrumentId, t.isCC);
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
                  balance={active ? bal.toFixed(4) : "—"}
                  fiatValue={active ? fiat : undefined}
                  comingSoon={!active}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}
