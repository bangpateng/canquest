"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getPointsBalance, type PointsBalance } from "@/lib/services/api/points";
import { queryKeys } from "@/lib/queries/query-keys";

/**
 * Saldo points user via react-query (key `["points"]` — dishare antara
 * Quest hub dan Dashboard supaya tidak ada fetch ganda). Invalidation:
 * `invalidatePoints()` setelah aksi yang mengubah saldo (task verified, dll).
 */
export function usePoints() {
  return useQuery<PointsBalance>({
    queryKey: queryKeys.points,
    queryFn: getPointsBalance,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Invalidate cache points — saldo akan di-refetch pada mount/render berikutnya. */
export function useInvalidatePoints() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.points });
}
