"use client";

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

/**
 * Main wallet view — daftar kartu token yang bisa diklik.
 *
 * Phase 1: hanya 1 kartu CC (Amulet). Saldo dari useCcBalance, harga dari
 * useCcPrice. Klik → detail view /wallet/cc.
 *
 * Phase 2 (saat swap live): tambah kartu token non-CC dari swap/balances.
 */
export function TokenList({ me, onRefresh }: TokenListProps) {
  const router = useRouter();
  const hasWallet = isRealCantonPartyId(me.cantonPartyId);

  const {
    balance,
    loading: balanceLoading,
    refresh: fetchBalance,
  } = useCcBalance({ enabled: hasWallet, pollIntervalMs: 90_000 });

  const { price: ccUsdPrice, change24hPct } = useCcPrice();
  const ccUsd = ccUsdPrice ?? 0;

  const ccBalanceStr = balanceLoading
    ? "—"
    : (balance?.toFixed(4) ?? "0.0000");

  const ccFiat =
    !balanceLoading && ccUsd > 0 && balance !== null
      ? `$${(balance * ccUsd).toLocaleString("en-US", {
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
          onClick={() => {
            void fetchBalance();
            onRefresh?.();
          }}
          disabled={balanceLoading}
          className="rounded-xl p-2.5 text-slate-400 transition-all duration-200 hover:bg-white/[0.06] hover:text-slate-100 disabled:opacity-40"
          aria-label="Refresh balance"
        >
          {balanceLoading ? (
            <LoadingSpinner size="sm" tone="muted" />
          ) : (
            <RefreshCw className="h-4 w-4 sm:h-5 sm:w-5" />
          )}
        </button>
      </div>

      {/* Token cards */}
      <div className="space-y-3">
        <TokenCard
          symbol="Amulet"
          balance={ccBalanceStr}
          fiatValue={ccFiat}
          change24hPct={change24hPct ?? undefined}
          onClick={() => router.push(ROUTES.walletToken("cc"))}
        />
      </div>
    </div>
  );
}
