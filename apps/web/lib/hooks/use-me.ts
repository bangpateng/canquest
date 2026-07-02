"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries/query-keys";

export interface Me {
  id?: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  cantonPartyId?: string | null;
  avatarUrl?: string | null;
}

/**
 * Current user profile (`/api/me`) — backed by a SINGLE shared TanStack Query
 * cache so /api/me is fetched ONCE per stale window across ALL components.
 *
 * Sebelumnya /api/me dipanggil 6× mentah (dashboard, earn, quest, settings,
 * leaderboard, wallet-access) → banjir serverless function Vercel → 429.
 *
 *  - staleTime 120s: setelah fetch pertama, semua konsumsi baca cache (gratis).
 *  - refetchOnWindowFocus: refresh saat user balik ke tab.
 *  - `refresh()` manual: invalidate + refetch (mis. setelah update profile).
 *  - `loading` true hanya saat first-load (sebelum data turun).
 */
const STALE_MS = 120_000;

export function useMe() {
  const queryClient = useQueryClient();

  const fetchMe = useCallback(async (): Promise<Me | null> => {
    const res = await fetch("/api/me", {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  }, []);

  const query = useQuery({
    queryKey: queryKeys.party.me,
    queryFn: fetchMe,
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.party.me });
    return queryClient.fetchQuery({ queryKey: queryKeys.party.me, queryFn: fetchMe });
  }, [queryClient, fetchMe]);

  return {
    me: query.data ?? null,
    loading: query.isPending,
    refresh,
  };
}
