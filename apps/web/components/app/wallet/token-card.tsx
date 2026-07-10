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
  /** Click handler — navigate to detail view. */
  onClick?: () => void;
}

/**
 * Kartu token individual — dipakai di main wallet view (TokenList).
 * Layout: [logo] [nama + saldo] [chevron]. Klik → detail view.
 */
export function TokenCard({
  symbol,
  balance,
  fiatValue,
  onClick,
}: TokenCardProps) {
  const display = displayName(symbol);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 p-4 text-left transition-all duration-200",
        "hover:border-white/15 hover:bg-[#0d1018]/90 active:scale-[0.99]",
      )}
    >
      <TokenLogo symbol={symbol} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-100">{display}</span>
          {fiatValue && (
            <span className="text-xs text-slate-500 tabular-nums">
              {fiatValue}
            </span>
          )}
        </div>
        <div className="mt-0.5">
          <span className="text-sm font-medium tabular-nums text-slate-400">
            {balance} {display}
          </span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" aria-hidden />
    </button>
  );
}
