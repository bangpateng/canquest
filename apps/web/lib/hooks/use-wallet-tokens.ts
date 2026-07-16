"use client";

import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries/query-keys";
import type { BalancesResponse, PoolsResponse } from "@/lib/canton/token-types";

/**
 * Daftar instrument/token dari AMM pools (GET /api/party/pools).
 *
 * Query key `queryKeys.party.pools` dishared lintas komponen wallet
 * (TokenList + WalletActions). Karena memakai key yang sama, react-query
 * otomatis men-dedup request — sebelumnya TokenList & WalletActions masing-
 * masing fetch `/api/party/pools` sendiri (2x request duplikat saat mount).
 *
 * `enabled` di-gate pada `hasWallet` supaya guest (tanpa wallet) tidak
 * memunculkan request 401 sia-sia.
 */
export function usePools(opts?: {
  enabled?: boolean;
}): UseQueryResult<PoolsResponse> {
  return useQuery<PoolsResponse>({
    queryKey: queryKeys.party.pools,
    queryFn: async (): Promise<PoolsResponse> => {
      const res = await fetch("/api/party/pools", { credentials: "include" });
      if (!res.ok) throw new Error(`pools ${res.status}`);
      const data = (await res.json()) as PoolsResponse;
      return { tokens: data?.tokens ?? [] };
    },
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Semua saldo (CC + token non-CC) dari satu endpoint (GET /api/party/balances).
 *
 * Sama seperti usePools: key dishared → dedup antar TokenList & WalletActions.
 */
export function useBalances(opts?: {
  enabled?: boolean;
}): UseQueryResult<BalancesResponse> {
  return useQuery<BalancesResponse>({
    queryKey: queryKeys.party.balances,
    queryFn: async (): Promise<BalancesResponse> => {
      const res = await fetch("/api/party/balances", { credentials: "include" });
      if (!res.ok) throw new Error(`balances ${res.status}`);
      const data = (await res.json()) as Partial<BalancesResponse>;
      return {
        cc: typeof data?.cc === "number" ? data.cc : 0,
        tokens: data?.tokens ?? {},
      };
    },
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    retry: 2,
  });
}

/**
 * Helper: invalidate pools + balances sekaligus (dipakai tombol Refresh wallet,
 * setelah send/swap, dll). Menggantikan callback `loadTokens`/`loadSendTokens`
 * manual yang sebelumnya re-fetch manual.
 */
export function useInvalidateWalletTokens() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.party.pools }),
      queryClient.invalidateQueries({ queryKey: queryKeys.party.balances }),
    ]);
}
