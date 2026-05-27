"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type NotificationTx = {
  kind: "transaction";
  id: string;
  type: "QUEST_REWARD" | "SPIN_REWARD" | "TRANSFER_IN";
  description: string;
  amountMicroCc: string;
  referenceId: string | null;
  counterparty?: string | null;
  createdAt: string;
};

export type NotificationDraw = {
  kind: "draw";
  id: string;
  drawKind: "win" | "loss";
  questId: string;
  questTitle: string;
  rewardCc: number | null;
  description: string;
  createdAt: string;
};

export type NotificationCode = {
  kind: "code";
  id: string;
  questId: string;
  questTitle: string;
  code: string;
  description: string;
  createdAt: string;
};

export type NotificationItem = NotificationTx | NotificationDraw | NotificationCode;

export type NotificationFeed = {
  unreadCount: number;
  lastSeenAt: string | null;
  items: NotificationItem[];
};

const DEFAULT_POLL_MS = 28_000;

type ToastPayload = {
  id: string;
  kind: "transaction" | "draw" | "code";
  drawKind?: "win" | "loss";
  txType?: NotificationTx["type"];
  amountCc: number;
  description: string;
};

type UseTransactionNotificationsOptions = {
  pollIntervalMs?: number;
  pauseWhenHidden?: boolean;
};

export function useTransactionNotifications(
  options: UseTransactionNotificationsOptions = {},
) {
  const { pollIntervalMs = DEFAULT_POLL_MS, pauseWhenHidden = true } = options;

  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastPayload[]>([]);
  const initialPollDone = useRef(false);
  const knownIds = useRef(new Set<string>());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchFeed = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch("/api/party/notifications?limit=12", {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return;
        const data = (await res.json()) as NotificationFeed;

        if (initialPollDone.current) {
          const fresh: ToastPayload[] = [];
          for (const item of data.items) {
            if (knownIds.current.has(item.id)) continue;
            knownIds.current.add(item.id);
            const created = new Date(item.createdAt).getTime();
            if (Date.now() - created > 120_000) continue;
            if (item.kind === "draw") {
              fresh.push({
                id: item.id,
                kind: "draw",
                drawKind: item.drawKind,
                amountCc: item.rewardCc ?? 0,
                description: item.description,
              });
            } else if (item.kind === "code") {
              fresh.push({
                id: item.id,
                kind: "code",
                amountCc: 0,
                description: `${item.questTitle}: ${item.code}`,
              });
            } else {
              fresh.push({
                id: item.id,
                kind: "transaction",
                txType: item.type,
                amountCc: Math.abs(Number(item.amountMicroCc)) / 1_000_000,
                description: item.description,
              });
            }
          }
          if (fresh.length > 0) {
            setToasts((prev) => [...fresh, ...prev].slice(0, 3));
          }
        } else {
          for (const item of data.items) knownIds.current.add(item.id);
          initialPollDone.current = true;
        }

        setFeed(data);
      } catch {
        /* ignore transient network errors */
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [],
  );

  const markSeen = useCallback(async () => {
    try {
      await fetch("/api/party/notifications/seen", {
        method: "POST",
        credentials: "include",
      });
      setFeed((prev) =>
        prev ? { ...prev, unreadCount: 0, lastSeenAt: new Date().toISOString() } : prev,
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void fetchFeed();

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPoll = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(
        () => void fetchFeed({ silent: true }),
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
        void fetchFeed({ silent: true });
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
  }, [fetchFeed, pollIntervalMs, pauseWhenHidden]);

  return {
    feed,
    loading,
    toasts,
    dismissToast,
    markSeen,
    refresh: fetchFeed,
  };
}
