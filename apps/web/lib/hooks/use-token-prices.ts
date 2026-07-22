"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/query-keys";

/**
 * Harga USD semua token dari Cantex DEX — REAL-TIME via backend WebSocket.
 * Backend maintains WS ticker connection; frontend polls endpoint tiap 5 menit
 * sebagai safety-net (push-based di backend, pull di frontend).
 *
 * NOTE: Data ini dari Cantex DEX, BUKAN dari Canton ledger — jadi tidak
 * ter-trigger oleh SSE Canton. Polling 5 menit dipertahankan sebagai refresh
 * periodik agar prices tidak stale terlalu lama.
 *
 * Key format: "<instrumentId>::<instrumentAdmin>" → USD price (number).
 */

interface PricesResponse {
  prices: Record<string, number>;
  source: string; // 'cantex_ws_live' | 'cantex_dex' (fallback)
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
