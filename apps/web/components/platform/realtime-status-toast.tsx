"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/utils";

/**
 * Toast status koneksi realtime — gaya sistem wallet, non-blocking.
 *
 * Mendengarkan event browser `cq:realtime` yang SUDAH di-emit `useRealtime()`
 * (detail: { connected: boolean }). Komponen ini MURNI presentasi:
 *  - tidak mengubah semantik event, tidak menyentuh SSE/backoff/reconnect,
 *  - tidak memblok apa pun (pointer-events-none, tanpa overlay/backdrop).
 *
 * Perilaku:
 *  - `connected: false` → diam dulu (grace 2.5s). Reconnect cepat = TIDAK ada
 *    notifikasi sama sekali.
 *  - masih terputus setelah grace → toast kecil "Reconnecting…" (spinner).
 *    Tetap di situ selama terputus (tidak escalate ke warning amber).
 *  - `connected: true` → ganti singkat jadi "Connected" (centang) lalu
 *    auto-dismiss ~1.2s.
 *
 * Anti-duplikat: `shownRef` menandai toast "Reconnecting" sedang tampil, dan
 * satu timer grace + satu timer dismiss. Event `connected:false` berulang
 * tidak menumpuk timer/toast.
 */
const GRACE_MS = 2500;
const CONNECTED_VISIBLE_MS = 1200;

type Phase = "idle" | "reconnecting" | "connected";

export function RealtimeStatusToast() {
  const [phase, setPhase] = useState<Phase>("idle");
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** true = toast "Reconnecting…" sedang tampil (grace sudah lewat). */
  const shownRef = useRef(false);

  useEffect(() => {
    function clearGrace() {
      if (graceTimer.current) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
    }
    function clearConnected() {
      if (connectedTimer.current) {
        clearTimeout(connectedTimer.current);
        connectedTimer.current = null;
      }
    }

    function onRealtime(e: Event) {
      const detail = (e as CustomEvent<{ connected?: boolean }>).detail;
      const connected = Boolean(detail?.connected);

      if (connected) {
        clearGrace();
        // Belum sempat menampilkan apa pun (reconnect dalam grace) → tetap diam.
        if (!shownRef.current) return;
        // Sedang tampil "Reconnecting…" → ganti singkat ke "Connected".
        clearConnected();
        setPhase("connected");
        connectedTimer.current = setTimeout(() => {
          connectedTimer.current = null;
          shownRef.current = false;
          setPhase("idle");
        }, CONNECTED_VISIBLE_MS);
        return;
      }

      // Terputus.
      if (shownRef.current) {
        // Toast sudah tampil → pertahankan (jangan reset/duplikat).
        clearConnected();
        setPhase("reconnecting");
        return;
      }
      if (graceTimer.current) return; // grace sudah berjalan → jangan tumpuk.
      clearConnected();
      graceTimer.current = setTimeout(() => {
        graceTimer.current = null;
        shownRef.current = true;
        setPhase("reconnecting");
      }, GRACE_MS);
    }

    window.addEventListener("cq:realtime", onRealtime);
    return () => {
      window.removeEventListener("cq:realtime", onRealtime);
      clearGrace();
      clearConnected();
    };
  }, []);

  const visible = phase !== "idle";

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[70] -translate-x-1/2 sm:bottom-6"
      aria-live="polite"
      aria-hidden={!visible}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 py-2 text-xs font-medium text-[var(--foreground)] shadow-lg transition-all duration-200",
          visible
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0",
        )}
      >
        {phase === "reconnecting" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--muted-foreground)]" />
            <span>Reconnecting…</span>
          </>
        ) : phase === "connected" ? (
          <>
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>Connected</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
