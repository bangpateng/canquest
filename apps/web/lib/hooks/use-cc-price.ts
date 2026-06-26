"use client";

import { useEffect, useState } from "react";

/**
 * Shared CC/USD price hook.
 *
 * Memanggil /api/party/cc-price (realtime Bybit CCUSDT) setiap 30 detik.
 * Di-dedup lintas komponen: berapa pun komponen yang pakai, hanya ada SATU interval.
 *
 * Mengembalikan:
 *  - price: harga terakhir (number) atau null saat belum tersedia.
 *  - change24hPct: persen perubahan 24 jam (number, sudah dalam %) atau null.
 *
 * Catatan: history 24 jam untuk sparkline di-serve terpisah lewat
 * /api/party/cc-price-history (kline Bybit) — dipakai langsung oleh kartu
 * harga di Overview, bukan di hook ini, supaya tidak dibebani polling.
 */

interface CcPriceState {
  price: number | null;
  change24hPct: number | null;
}

let cachedPrice: number | null = null;
let cachedChange24hPct: number | null = null;

const subscribers = new Set<(s: CcPriceState) => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

function snapshot(): CcPriceState {
  return { price: cachedPrice, change24hPct: cachedChange24hPct };
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

  useEffect(() => {
    subscribers.add(setState);
    setState(snapshot());

    if (!pollTimer) {
      void fetchPrice();
      pollTimer = setInterval(() => void fetchPrice(), 30_000);
    }

    return () => {
      subscribers.delete(setState);
      if (subscribers.size === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, []);

  return state;
}
