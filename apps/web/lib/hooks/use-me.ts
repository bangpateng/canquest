"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { getMe, type Me } from "@/lib/services/api/auth";
import { queryKeys } from "@/lib/queries/query-keys";

/**
 * Profil user ter-cache global (GET /api/me). Semua konsumen memakai query key
 * yang sama (`queryKeys.auth.me`) sehingga request ter-dedup lintas komponen —
 * navigasi antar halaman tidak lagi memunculkan request `/api/me` baru selama
 * data masih segar (staleTime default QueryClient = 60s).
 *
 * Catatan: getMe() di lib/services/api/auth.ts sudah memakai credentials +
 * AbortSignal.timeout(8s) via apiFetch, jadi error/jaringan ditangani di sana.
 */
export function useMe(): UseQueryResult<Me> & {
  me: Me | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: UseQueryResult<Me>["refetch"];
} {
  const query = useQuery<Me>({
    queryKey: queryKeys.auth.me,
    queryFn: getMe,
    retry: 2,
  });

  return {
    ...query,
    me: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

export type { Me } from "@/lib/services/api/auth";
