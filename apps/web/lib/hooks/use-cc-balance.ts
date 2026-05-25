"use client";

import { useCallback, useEffect, useState } from "react";

const DEFAULT_POLL_MS = 30_000;

type UseCcBalanceOptions = {
  /** When false, no fetch/poll (e.g. user has no wallet yet). */
  enabled?: boolean;
  pollIntervalMs?: number;
  pauseWhenHidden?: boolean;
};

/**
 * Live CC balance from `/api/party/balance` (triggers inbound sync on the API).
 * Polls on an interval so inbound transfers and sends show up without a full page reload.
 */
export function useCcBalance(options: UseCcBalanceOptions = {}) {
  const {
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_MS,
    pauseWhenHidden = true,
  } = options;

  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const fetchBalance = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!enabled) return;
      if (!opts?.silent) setLoading(true);
      setError(false);
      try {
        const res = await fetch("/api/party/balance", {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          const data = (await res.json()) as { balance?: number | null };
          setBalance(data.balance ?? 0);
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [enabled],
  );

  /** Immediate refresh + follow-up polls (chain settlement can lag a few seconds). */
  const refreshWithRetries = useCallback(() => {
    void fetchBalance();
    const delays = [3_000, 8_000, 20_000];
    const timers = delays.map((ms) =>
      setTimeout(() => void fetchBalance({ silent: true }), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [fetchBalance]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void fetchBalance();

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPoll = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(
        () => void fetchBalance({ silent: true }),
        pollIntervalMs,
      );
    };

    const stopPoll = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    startPoll();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void fetchBalance({ silent: true });
        startPoll();
      } else if (pauseWhenHidden) {
        stopPoll();
      }
    };

    if (pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }

    return () => {
      stopPoll();
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [enabled, fetchBalance, pollIntervalMs, pauseWhenHidden]);

  return {
    balance,
    loading,
    error,
    refresh: fetchBalance,
    refreshWithRetries,
  };
}
