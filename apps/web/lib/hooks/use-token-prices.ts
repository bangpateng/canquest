"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/query-keys";

/**
 * Harga USD semua token dari Cantex DEX — REAL-TIME via backend WebSocket.
 * Backend maintains WS ticker connection; frontend polls endpoint tiap 10s
 * untuk dapat latest live prices (push-based di backend, pull di frontend).
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
      const res = await fetch("/api/party/swap/prices", {
        credentials: "include",
      });
      const data = (await res.json()) as PricesResponse;
      if (!res.ok) return {};
      return data.prices ?? {};
    },
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  return {
    prices: query.data ?? {},
    loading: query.isPending,
    error: query.error,
  };
}

/** Refresh helper untuk invalidate cache prices (mis. setelah swap). */
export function useRefreshTokenPrices() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.party.tokenPrices });
}
