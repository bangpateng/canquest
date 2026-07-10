"use client";

import { queryKeys } from "@/lib/queries/query-keys";
import { useTokenPrices } from "@/lib/hooks/use-token-prices";

/**
 * Shared CC/USD price hook — Cantex DEX real-time (WS live feed).
 *
 * Sebelumnya: Bybit CCUSDT spot ticker.
 * Sekarang: Cantex DEX rate (Amulet→USDCx via public WS price feed).
 *
 * Mengembalikan:
 *  - price: harga CC dari Cantex DEX (number) atau null.
 *  - change24hPct: null (Cantex tidak punya history API — dihilangkan).
 *
 * Tetap export { price, change24hPct } supaya semua consumer lama (cards,
 * sidebar, detail view) tidak perlu berubah. change24hPct selalu null
 * = UI yang menampilkannya otomatis disembunyikan (guard null).
 */

interface CcPriceState {
  price: number | null;
  change24hPct: number | null;
}

const EMPTY: CcPriceState = { price: null, change24hPct: null };

export function useCcPrice(): CcPriceState {
  const { prices } = useTokenPrices();
  // Cari harga Amulet (CC) di price map.
  // Key format: "<instrumentId>::<instrumentAdmin>".
  const ccKey = Object.keys(prices).find((k) =>
    k.toUpperCase().startsWith("AMULET::"),
  );
  const price = ccKey ? prices[ccKey] ?? null : null;
  if (price === null) return EMPTY;
  return { price, change24hPct: null };
}

/** Query key tetap dipertahankan untuk backward-compat (invalidation calls). */
export const CC_PRICE_QUERY_KEY = queryKeys.party.ccPrice;
