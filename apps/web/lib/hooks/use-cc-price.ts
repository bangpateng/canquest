"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shared CC/USD price hook.
 *
 * Memanggil /api/party/cc-price (realtime Bybit CCUSDT) setiap 30 detik.
 * Di-dedup lintas komponen: berapa pun komponen yang pakai, hanya ada SATU interval.
 *
 * Mengembalikan:
 *  - price: harga terakhir (number) atau null saat belum tersedia.
 *  - change24hPct: persen perubahan 24 jam (number, sudah dalam %) atau null.
 *  - history: buffer harga selama sesi ini (number[]) untuk sparkline.
 */

const MAX_HISTORY = 60;

let cachedPrice: number | null = null;
let cachedChange24hPct: number | null = null;
const history: number[] = [];

interface CcPriceState {
  price: number | null;
  change24hPct: number | null;
  history: number[];
}

const subscribers = new Set<(s: CcPriceState) => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function snapshot(): CcPriceState {
  return { price: cachedPrice, change24hPct: cachedChange24hPct, history: [...history] };
}

function notify(): void {
  const snap = snapshot();
  subscribers.forEach((fn) => fn(snap));
}

async function fetchPrice(): Promise<void> {
  try {
    const r = await fetch("/api/party/cc-price", { credentials: "include" });
    if (!r.ok) return;
    const d = (await r.json()) as {
      lastPrice?: number | null;
      change24hPct?: number | null;
    };
    let changed = false;
    if (typeof d?.lastPrice === "number" && d.lastPrice > 0) {
      cachedPrice = d.lastPrice;
      history.push(d.lastPrice);
      if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
      changed = true;
    }
    if (typeof d?.change24hPct === "number" && !Number.isNaN(d.change24hPct)) {
      cachedChange24hPct = d.change24hPct;
      changed = true;
    }
    if (changed) notify();
  } catch {
    /* diam — harga hanya untuk tampilan, jangan ganggu UI */
  }
}

export function useCcPrice(): CcPriceState {
  const [state, setState] = useState<CcPriceState>(snapshot);
  // Keep referensi stabil untuk effect deps.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener = (s: CcPriceState) => {
      if (mounted.current) setState(s);
    };
    subscribers.add(listener);
    setState(snapshot());

    if (!pollTimer) {
      void fetchPrice();
      pollTimer = setInterval(() => void fetchPrice(), 30_000);
    }

    return () => {
      mounted.current = false;
      subscribers.delete(listener);
      if (subscribers.size === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, []);

  return state;
}
