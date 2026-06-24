"use client";

import { useCallback, useEffect, useState } from "react";

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
 * Polls on an interval so unlock eligibility reflects without manual refresh.
 */
export function useLockStatus(options: UseLockStatusOptions = {}) {
  const { enabled = true, pollIntervalMs = 45_000 } = options;

  const [status, setStatus] = useState<LockStatus>(EMPTY);
  const [loading, setLoading] = useState(enabled);

  const fetchStatus = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!enabled) return;
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch("/api/party/lock-status", {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          const data = (await res.json()) as Partial<LockStatus>;
          setStatus({
            lockedCc: data.lockedCc ?? 0,
            availableCc: data.availableCc ?? null,
            tier: data.tier ?? "NONE",
            activeLocks: data.activeLocks ?? [],
            hasWallet: data.hasWallet ?? false,
          });
        }
      } catch {
        /* silent — keep last known status */
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [enabled],
  );

  /** Immediate refresh + follow-up polls (chain settlement can lag a few seconds). */
  const refreshWithRetries = useCallback(() => {
    void fetchStatus();
    const delays = [3_000, 8_000];
    const timers = delays.map((ms) =>
      setTimeout(() => void fetchStatus({ silent: true }), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [fetchStatus]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void fetchStatus();
    const id = setInterval(
      () => void fetchStatus({ silent: true }),
      pollIntervalMs,
    );
    return () => clearInterval(id);
  }, [enabled, fetchStatus, pollIntervalMs]);

  return {
    status,
    loading,
    refresh: fetchStatus,
    refreshWithRetries,
  };
}
