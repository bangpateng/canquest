"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { realtimeStreamUrl } from "./realtime-origin";
import { queryKeys } from "@/lib/queries/query-keys";

/**
 * Hook: buka koneksi SSE ke API, terjemahkan event server → invalidate cache
 * TanStack Query. UI tidak berubah — data tetap lewat react-query, SSE hanya
 * jadi pemicu update instan.
 *
 * Lifecycle:
 *  1. Minta token SSE ephemeral via BFF `/api/auth/sse-token` (baca cookie httpOnly).
 *  2. Buka EventSource ke `api.canquest.cc/api/realtime/stream?token=...`.
 *  3. Saat event masuk → invalidate query key terkait (refetch background, silent).
 *  4. Token 60s → refresh token tiap ~50s, ganti EventSource.
 *  5. Saat putus → EventSource auto-reconnect + backoff eksponensial.
 *
 * Pasang SEKALI di root (Providers) — di dalam QueryClientProvider supaya bisa
 * akses useQueryClient. No-op bila belum login (BFF return 401 → tidak connect).
 */
export function useRealtime(): void {
  const queryClient = useQueryClient();
  // Ref supaya handler event baca versi terbaru queryClient tanpa re-bind listener.
  const esRef = useRef<EventSource | null>(null);
  const tokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryMs = 5_000;

    /** Minta token ephemeral lalu buka koneksi SSE. */
    const connect = async () => {
      if (cancelled) return;

      // Tutup koneksi lama (kalau ada, mis. saat refresh token).
      esRef.current?.close();

      let token: string;
      try {
        const res = await fetch("/api/auth/sse-token", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          // 401 = belum login. Diam — jangan loop retry (bakal spam BFF).
          if (res.status === 401) return;
          throw new Error(`sse-token ${res.status}`);
        }
        const data = (await res.json()) as { token?: string };
        if (!data.token) return;
        token = data.token;
      } catch {
        // Network error → backoff lalu coba lagi.
        scheduleReconnect();
        return;
      }

      if (cancelled) return;

      // ── Buka EventSource (no credentials — token sudah di query param) ─────
      const es = new EventSource(realtimeStreamUrl(token), {
        withCredentials: false,
      });
      esRef.current = es;
      // Koneksi sukses → reset backoff.
      retryMs = 5_000;

      // Server konfirmasi koneksi sukses → schedule refresh token berikutnya.
      es.addEventListener("ready", () => {
        if (cancelled) return;
        // Refresh token sebelum expired (60s token → refresh di 50s).
        if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
        tokenTimerRef.current = setTimeout(() => void connect(), 50_000);
      });

      // ── Event → invalidate cache (UI update via react-query, silent) ──────
      es.addEventListener("transaction:new", () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.party.transactions.all,
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.party.notifications,
        });
      });

      es.addEventListener("balance:changed", () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.party.balance,
        });
      });

      es.addEventListener("quest:progress", () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.quests.all });
      });

      // Saat koneksi error/putus → EventSource auto-reconnect, tapi kalau
      // token sudah expired (401 dari server saat reconnect), kita perlu minta
      // token baru. Backoff lalu reconnect full.
      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (cancelled) return;
        scheduleReconnect();
      };
    };

    /** Reconnect dengan backoff eksponensial (mulai 5s, maks 60s). */
    const scheduleReconnect = () => {
      if (cancelled) return;
      if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
      tokenTimerRef.current = setTimeout(() => void connect(), retryMs);
      retryMs = Math.min(retryMs * 2, 60_000);
    };

    void connect();

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (tokenTimerRef.current) clearTimeout(tokenTimerRef.current);
      tokenTimerRef.current = null;
    };
  }, [queryClient]);
}
