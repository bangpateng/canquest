"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries/query-keys";

export type LockTier = "NONE" | "FULL";

export interface ActiveLock {
  id: string;
  amountCc: number;
  termKey: string;
  lockSeconds: number;
  expiresAt: string;
  lockedAmuletCid: string | null;
}

export interface LockStatus {
  lockedCc: number;
  availableCc: number | null;
  tier: LockTier;
  activeLocks: ActiveLock[];
  hasWallet: boolean;
}

const EMPTY: LockStatus = {
  lockedCc: 0,
  availableCc: null,
  tier: "NONE",
  activeLocks: [],
  hasWallet: false,
};

type UseLockStatusOptions = {
  /** When false, no fetch/poll (e.g. user has no wallet yet). */
  enabled?: boolean;
  pollIntervalMs?: number;
};

/**
 * Live CC Lock status from `/api/party/lock-status`.
 * lockedCc/tier = on-chain truth; activeLocks = metadata rows for the manage UI.
 *
 * Di-back TanStack Query: background poll via refetchInterval (SILENT),
 * `loading` hanya true saat first-load. Refetch saat tab focus / reconnect.
 */
export function useLockStatus(options: UseLockStatusOptions = {}) {
  const { enabled = true, pollIntervalMs = 45_000 } = options;
  const queryClient = useQueryClient();

  const fetchStatus = useCallback(async (): Promise<LockStatus> => {
    const res = await fetch("/api/party/lock-status", {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`lock-status ${res.status}`);
    const data = (await res.json()) as Partial<LockStatus>;
    return {
      lockedCc: data.lockedCc ?? 0,
      availableCc: data.availableCc ?? null,
      tier: data.tier ?? "NONE",
      activeLocks: data.activeLocks ?? [],
      hasWallet: data.hasWallet ?? false,
    };
  }, []);

  const query = useQuery({
    queryKey: queryKeys.party.lockStatus,
    queryFn: fetchStatus,
    enabled,
    staleTime: pollIntervalMs,
    refetchInterval: enabled ? pollIntervalMs : false,
    refetchOnWindowFocus: enabled,
    retry: 2,
  });

  const refreshWithRetries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.party.lockStatus });
  }, [queryClient]);

  return {
    status: enabled ? (query.data ?? EMPTY) : EMPTY,
    /** true hanya saat first-load (belum ada data). Background poll tidak memicu. */
    loading: enabled ? query.isPending : false,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.party.lockStatus }),
    refreshWithRetries,
  };
}
