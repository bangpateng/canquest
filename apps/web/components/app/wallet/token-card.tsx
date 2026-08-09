"use client";

import { cn } from "@/lib/utils/utils";
import { Card } from "@/components/ui/card";
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
    <Card
      className={cn(
        "flex w-full items-center gap-3 p-4",
        comingSoon && "opacity-60",
      )}
    >
      <TokenLogo symbol={symbol} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--foreground)]">
            {display}
          </span>
          {comingSoon && (
            <span className="rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Coming soon
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {comingSoon ? (
          <span className="text-sm font-medium text-[var(--muted-foreground)]">—</span>
        ) : (
          <>
            <p className="text-sm font-bold tabular-nums text-[var(--foreground)]">
              {balance}
            </p>
            {fiatValue && (
              <p className="text-xs tabular-nums text-[var(--muted-foreground)]">
                {fiatValue}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
