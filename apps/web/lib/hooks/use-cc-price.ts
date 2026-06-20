"use client";

import { useEffect, useState } from "react";

/**
 * Shared CC/USD price hook.
 *
 * Memanggil /api/party/cc-price (realtime Bybit CCUSDT) setiap 30 detik.
 * Di-dedup lintas komponen: berapa pun komponen yang pakai, hanya ada SATU interval.
 * Mengembalikan harga terakhir (number) atau null saat belum tersedia.
 */

let cachedPrice: number | null = null;
const subscribers = new Set<(p: number | null) => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function fetchPrice(): Promise<void> {
  try {
    const r = await fetch("/api/party/cc-price", { credentials: "include" });
    if (!r.ok) return;
    const d = (await r.json()) as { lastPrice?: number | null };
    if (typeof d?.lastPrice === "number" && d.lastPrice > 0) {
      cachedPrice = d.lastPrice;
      subscribers.forEach((fn) => fn(cachedPrice));
    }
  } catch {
    /* diam — harga hanya untuk tampilan, jangan ganggu UI */
  }
}

export function useCcPrice(): number | null {
  const [price, setPrice] = useState<number | null>(cachedPrice);

  useEffect(() => {
    subscribers.add(setPrice);
    if (cachedPrice !== null) setPrice(cachedPrice);

    if (!pollTimer) {
      void fetchPrice();
      pollTimer = setInterval(() => void fetchPrice(), 30_000);
    }

    return () => {
      subscribers.delete(setPrice);
      if (subscribers.size === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  }, []);

  return price;
}