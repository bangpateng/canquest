"use client";

import { useCcPrice } from "@/lib/hooks/use-cc-price";

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
 *
 * - Mengembalikan null saat harga belum tersedia atau cc <= 0, jadi UI tidak pernah
 *   menampilkan nilai rusak (mis. "$NaN" atau "$0.00" yang menyesatkan).
 * - Format adaptif: >= $1 → 2 desimal; kecil → 3–4 desimal biar tidak jadi $0.00.
 *
 * Contoh: <span>10 CC <CcUsdValue cc={10} /></span>  →  10 CC ≈ $1.64
 */
export function CcUsdValue({ cc, className, prefix = "≈ " }: CcUsdValueProps) {
  const price = useCcPrice();
  if (!price || cc <= 0) return null;

  const usd = cc * price;
  const formatted =
    usd >= 1 ? usd.toFixed(2) : usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4);

  return (
    <span className={className ?? "text-xs text-[var(--muted-foreground)]"}>
      {prefix}${formatted}
    </span>
  );
}