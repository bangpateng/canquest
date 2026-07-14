"use client";

import { cn } from "@/lib/utils/utils";
import { TokenLogo, displayName } from "./token-logo";

export interface TokenCardProps {
  /** Internal instrument id (e.g. "Amulet" for CC). */
  symbol: string;
  /** Human-readable balance. */
  balance: string;
  /** Optional fiat value (e.g. "$3.74"). */
  fiatValue?: string;
  /** Show "Coming soon" badge + dimmed style (token not yet active). */
  comingSoon?: boolean;
}

/**
 * Kartu token individual — dipakai di main wallet view (TokenList).
 * Display-only (non-clickable): logo + nama + saldo + fiat. Semua aksi token
 * (Send/Swap/Lock) ada di WalletActions di atas, jadi kartu tidak perlu navigasi.
 */
export function TokenCard({ symbol, balance, fiatValue, comingSoon }: TokenCardProps) {
  const display = displayName(symbol);

  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 p-4 text-left",
        comingSoon && "opacity-50",
      )}
    >
      <TokenLogo symbol={symbol} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-100">{display}</span>
            {comingSoon && (
              <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                Coming soon
              </span>
            )}
          </div>
          {fiatValue && !comingSoon && (
            <span className="text-xs text-slate-500 tabular-nums">
              {fiatValue}
            </span>
          )}
        </div>
        <div className="mt-0.5">
          <span className="text-sm font-medium tabular-nums text-slate-400">
            {comingSoon ? "—" : `${balance} ${display}`}
          </span>
        </div>
      </div>
    </div>
  );
}
