import Image from "next/image";
import { tokenLogoUrl } from "@/lib/canton/cc-reward-logo";
import { cn } from "@/lib/utils/utils";

/** Just the token logo image (no label / no pill). */
export function TokenLogo({
  symbol,
  size = 16,
  className,
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src={tokenLogoUrl(symbol)}
      alt={symbol}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full", className)}
      unoptimized
    />
  );
}

/**
 * Small token badge: real logo from the API + symbol label.
 * Uses next/image so it's optimized & cached.
 *
 * Example: <TokenBadge symbol="CC" /> → CC logo + "CC"
 */
export function TokenBadge({
  symbol,
  label = true,
  size = 16,
  className,
}: {
  symbol: string;
  /** Show the symbol text next to the logo. Default true. */
  label?: boolean;
  /** Logo diameter in px. Default 16. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-canton-muted bg-canton-subtle px-3 py-1 text-xs font-semibold text-canton",
        className,
      )}
    >
      <TokenLogo symbol={symbol} size={size} />
      {label ? symbol : null}
    </span>
  );
}
