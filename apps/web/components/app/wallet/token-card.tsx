"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/utils";
import { TokenLogo, displayName } from "./token-logo";

export interface TokenCardProps {
  /** Internal instrument id (e.g. "Amulet" for CC). */
  symbol: string;
  /** Human-readable balance. */
  balance: string;
  /** Optional fiat value (e.g. "$3.74"). */
  fiatValue?: string;
  /** Optional 24h change percentage (e.g. 2.1 = +2.1%). */
  change24hPct?: number;
  /** Click handler — navigate to detail view. */
  onClick?: () => void;
}

/**
 * Kartu token individual — dipakai di main wallet view (TokenList).
 * Klik → navigate ke detail view (/wallet/<tokenId>).
 */
export function TokenCard({
  symbol,
  balance,
  fiatValue,
  change24hPct,
  onClick,
}: TokenCardProps) {
  const display = displayName(symbol);
  const change = change24hPct ?? 0;
  const isPositive = change >= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 p-4 text-left transition-all duration-200",
        "hover:border-white/15 hover:bg-[#0d1018]/90 active:scale-[0.99]",
      )}
    >
      <TokenLogo symbol={symbol} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-bold text-white">{display}</span>
          {change24hPct !== undefined && (
            <span
              className={cn(
                "text-xs font-semibold tabular-nums",
                isPositive ? "text-emerald-400" : "text-red-400",
              )}
            >
              {isPositive ? "+" : ""}
              {change.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-sm font-medium tabular-nums text-slate-200">
            {balance} {display}
          </span>
          {fiatValue && (
            <span className="text-xs text-slate-500 tabular-nums">
              ≈ {fiatValue}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-600" aria-hidden />
    </button>
  );
}
