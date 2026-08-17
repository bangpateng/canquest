"use client";

import { useTokenPrices } from "@/lib/hooks/use-token-prices";

/** Map simbol reward / instrumentId ke key price map /party/prices. */
export function tokenPriceKey(token: string): string | null {
  // CC (Amulet) adalah satu-satunya simbol yang key price-nya beda dari
  // lowercase instrumentId ("amulet", bukan "cc").
  if (token.toUpperCase() === "CC") return "amulet";
  const key = token.toLowerCase();
  return key || null;
}

interface TokenUsdValueProps {
  /** Jumlah token yang dikonversi ke USD. */
  amount: number;
  /** Simbol reward ("CC" | "USDCx") atau instrumentId mentah. */
  token: string;
  /** className opsional untuk wrapper <span>. */
  className?: string;
  /** Awalan, default "≈ ". Set "" untuk tanpa awalan. */
  prefix?: string;
}

/**
 * Render "≈ $X.XX" di sebelah jumlah token (CC / USDCx / instrumentId lain),
 * pakai harga USD realtime dari /party/prices (CC = amuletPrice on-chain,
 * USDCx = anchor $1).
 *
 * - Mengembalikan null saat harga belum tersedia atau amount <= 0, jadi UI tidak
 *   pernah menampilkan nilai rusak (mis. "$NaN" atau "$0.00" yang menyesatkan).
 *   Token tanpa harga (mis. CBTC) otomatis tanpa label USD.
 * - Format adaptif: >= $1 → 2 desimal; kecil → 3–4 desimal biar tidak jadi $0.00.
 *
 * Contoh: <span>10 CC <TokenUsdValue amount={10} token="CC" /></span>  →  10 CC ≈ $1.64
 */
export function TokenUsdValue({
  amount,
  token,
  className,
  prefix = "≈ ",
}: TokenUsdValueProps) {
  const { prices } = useTokenPrices();
  const key = tokenPriceKey(token);
  const price = key ? prices[key] : undefined;
  if (!price || amount <= 0) return null;

  const usd = amount * price;
  const formatted =
    usd >= 1 ? usd.toFixed(2) : usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4);

  return (
    <span className={className ?? "text-xs text-[var(--muted-foreground)]"}>
      {prefix}${formatted}
    </span>
  );
}

interface CcUsdValueProps {
  /** Jumlah CC yang dikonversi ke USD. */
  cc: number;
  /** className opsional untuk wrapper <span>. */
  className?: string;
  /** Awalan, default "≈ ". Set "" untuk tanpa awalan. */
  prefix?: string;
}

/**
 * Render "≈ $X.XX" di sebelah jumlah CC, pakai harga CC/USD realtime.
 * Wrapper CC-only dari TokenUsdValue — consumer lama tidak perlu berubah.
 *
 * Contoh: <span>10 CC <CcUsdValue cc={10} /></span>  →  10 CC ≈ $1.64
 */
export function CcUsdValue({ cc, className, prefix = "≈ " }: CcUsdValueProps) {
  return (
    <TokenUsdValue amount={cc} token="CC" className={className} prefix={prefix} />
  );
}
