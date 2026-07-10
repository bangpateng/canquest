"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queries/query-keys";

/**
 * Harga USD semua token dari Cantex DEX (rate token→USDCx, USDCx = $1).
 * Cache 30s di backend; frontend poll 60s (dedup global oleh TanStack Query).
 *
 * Key format: "<instrumentId>::<instrumentAdmin>" → USD price (number).
 * Contoh: { "Amulet::admin...": 0.30, "USDCx::admin...": 1.0, ... }
 */

interface PricesResponse {
  prices: Record<string, number>;
  source: string;
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
    staleTime: 60_000,
    refetchInterval: 60_000,
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
