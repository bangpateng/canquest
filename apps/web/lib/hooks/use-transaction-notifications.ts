"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries/query-keys";

export type NotificationTx = {
  kind: "transaction";
  id: string;
  type:
    | "QUEST_REWARD"
    | "SPIN_REWARD"
    | "TRANSFER_IN"
    | "TRANSFER_OUT"
    | "CC_LOCK"
    | "CC_UNLOCK"
    | "OFFER_REJECTED"
    | "OFFER_WITHDRAWN"
    | "PREAPPROVAL_ENABLED"
    | "PREAPPROVAL_DISABLED"
    // Token non-CC (CIP-0056 P2P transfer, mis. USDCx).
    | "TOKEN_TRANSFER_IN"
    | "TOKEN_TRANSFER_OUT"
    | "TOKEN_OFFER_REJECTED"
    | "TOKEN_OFFER_WITHDRAWN";
  description: string;
  amountMicroCc: string;
  referenceId: string | null;
  counterparty?: string | null;
  createdAt: string;
  /** Instrument id untuk token non-CC (mis. "USDCx"). null untuk CC. */
  instrumentId?: string | null;
  /** Amount token dalam unit asli (Decimal string). null untuk CC. */
  amountDecimal?: string | null;
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

const DEFAULT_POLL_MS = 120_000;

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
};

export function useTransactionNotifications(
  options: UseTransactionNotificationsOptions = {},
) {
  const { pollIntervalMs = DEFAULT_POLL_MS } = options;

  const queryClient = useQueryClient();
  const [toasts, setToasts] = useState<ToastPayload[]>([]);
  const initialPollDone = useRef(false);
  const knownIds = useRef(new Set<string>());

  const fetchFeed = useCallback(async (): Promise<NotificationFeed> => {
    const res = await fetch("/api/party/notifications?limit=12", {
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`notifications ${res.status}`);
    return (await res.json()) as NotificationFeed;
  }, []);

  const query = useQuery({
    queryKey: queryKeys.party.notifications,
    queryFn: fetchFeed,
    staleTime: pollIntervalMs,
    refetchInterval: pollIntervalMs,
    refetchOnWindowFocus: true,
    retry: 2,
  });

  // ── Diff feed untuk toast + invalidate cache cross-surface ────────────────
  // Saat data feed berubah (poll/refetch), cek apakah ada item baru. Item baru
  // → push toast + invalidate cache transactions/quests supaya surface lain
  // ikut update TANPA event bus manual (cc:new-tx diganti invalidateQueries).
  const feed = query.data ?? null;
  useEffect(() => {
    if (!feed) return;

    if (initialPollDone.current) {
      const fresh: ToastPayload[] = [];
      for (const item of feed.items) {
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
          // Token non-CC: amount dari amountDecimal (unit asli). CC: microCC → CC.
          const isToken =
            item.instrumentId != null &&
            item.instrumentId !== "Amulet" &&
            item.amountDecimal != null;
          const amountCc = isToken
            ? Math.abs(Number(item.amountDecimal))
            : Math.abs(Number(item.amountMicroCc)) / 1_000_000;
          fresh.push({
            id: item.id,
            kind: "transaction",
            txType: item.type,
            amountCc,
            description: item.description,
          });
        }
      }
      if (fresh.length > 0) {
        setToasts((prev) => [...fresh, ...prev].slice(0, 3));
        // Cross-surface sync: ganti event bus 'cc:new-tx' lama.
        // Invalidasi cache transactions + quests → surface terkait refetch
        // otomatis via react-query (background, silent, no flicker).
        void queryClient.invalidateQueries({ queryKey: queryKeys.party.transactions.all });
        void queryClient.invalidateQueries({ queryKey: queryKeys.quests.all });
      }
    } else {
      for (const item of feed.items) knownIds.current.add(item.id);
      initialPollDone.current = true;
    }
  }, [feed, queryClient]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markSeen = useCallback(async () => {
    try {
      await fetch("/api/party/notifications/seen", {
        method: "POST",
        credentials: "include",
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.party.notifications });
    } catch {
      /* ignore */
    }
  }, [queryClient]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.party.notifications });
  }, [queryClient]);

  return {
    feed,
    /** true hanya saat first-load (belum ada data). */
    loading: query.isPending,
    toasts,
    dismissToast,
    markSeen,
    refresh,
  };
}
