"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/query-keys";

/**
 * Harga USD semua token dari CantonPriceService (backend).
 * Sumber: CC dari Canton scan-proxy (amuletPrice); USDCx = $1 anchor; token
 * list (id+admin) dari OneSwap listTokens(). Cache 30s di backend.
 *
 * NOTE: Bukan dari Canton ledger event — tidak ter-trigger SSE Canton. Polling
 * 5 menit dipertahankan sebagai refresh periodik agar prices tidak stale.
 *
 * Key format: "<instrumentId>::<instrumentAdmin>" → USD price (number).
 */

interface PricesResponse {
  prices: Record<string, number>;
  source: string; // 'canton_scan_proxy'
}

export function useTokenPrices() {
  const query = useQuery({
    queryKey: queryKeys.party.tokenPrices,
    queryFn: async (): Promise<Record<string, number>> => {
      const res = await fetch("/api/party/prices", {
        credentials: "include",
      });
      const data = (await res.json()) as PricesResponse;
      if (!res.ok) return {};
      return data.prices ?? {};
    },
    // Bukan event Canton → tidak ada invalidasi via SSE. Poll 5 menit sebagai
    // safety-net (sebelumnya 30s, terlalu agresif untuk data non-Canton).
    staleTime: 300_000,
    refetchInterval: 300_000,
    retry: 1,
  });

  return {
    prices: query.data ?? {},
    loading: query.isPending,
    error: query.error,
  };
}
