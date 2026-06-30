"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries/query-keys";

const DEFAULT_POLL_MS = 45_000;

type UseCcBalanceOptions = {
  /** When false, no fetch/poll (e.g. user has no wallet yet). */
  enabled?: boolean;
  pollIntervalMs?: number;
};

/**
 * Live CC balance from `/api/party/balance` (triggers inbound sync on the API).
 *
 * Di-back oleh TanStack Query:
 *  - Polling background via `refetchInterval` — SILENT (tidak ada spinner).
 *  - `loading` = true HANYA saat first-load (sebelum data pertama turun),
 *    persis seperti dApp: spinner muncul sekali, lalu update diam-diam.
 *  - Refetch otomatis saat tab kembali focus / koneksi pulih.
 *  - Cache global → konsumsi hook di banyak komponen tetap 1 request.
 */
export function useCcBalance(options: UseCcBalanceOptions = {}) {
  const { enabled = true, pollIntervalMs = DEFAULT_POLL_MS } = options;
  const queryClient = useQueryClient();

  const fetchBalance = useCallback(async (): Promise<number> => {
    const res = await fetch("/api/party/balance", {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`balance ${res.status}`);
    const data = (await res.json()) as { balance?: number | null };
    return data.balance ?? 0;
  }, []);

  const query = useQuery({
    queryKey: queryKeys.party.balance,
    queryFn: fetchBalance,
    enabled,
    staleTime: pollIntervalMs,
    refetchInterval: enabled ? pollIntervalMs : false,
    refetchOnWindowFocus: enabled,
    // Balance adalah angka — keep last value saat refetch gagal (no flicker).
    retry: 2,
  });

  /**
   * Mutasi (send/lock) umumnya butuh konfirmasi on-chain yang lag beberapa
   * detik. Alih-alih 3 timer retry manual, kita invalidate cache lalu minta
   * react-query refetch; refetchInterval akan menjaga sinkronisasi lanjutan.
   */
  const refreshWithRetries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.party.balance });
  }, [queryClient]);

  return {
    balance: enabled ? (query.data ?? null) : null,
    /** true hanya saat first-load (belum ada data). Background poll tidak memicu. */
    loading: enabled ? query.isPending : false,
    error: query.isError,
    refresh: () => queryClient.invalidateQueries({ queryKey: queryKeys.party.balance }),
    refreshWithRetries,
  };
}
