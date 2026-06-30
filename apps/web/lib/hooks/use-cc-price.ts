"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/queries/query-keys";

/**
 * Shared CC/USD price hook.
 *
 * Memanggil /api/party/cc-price (realtime Bybit CCUSDT) setiap 30 detik.
 *
 * Dedup lintas komponen di-handle otomatis oleh TanStack Query: berapa pun
 * komponen yang pakai hook ini, hanya ada SATU network request per window
 * refetch (cache global queryKeys.party.ccPrice).
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

const EMPTY: CcPriceState = { price: null, change24hPct: null };

async function fetchPrice(): Promise<CcPriceState> {
  const r = await fetch("/api/party/cc-price", { credentials: "include" });
  if (!r.ok) return EMPTY;
  const d = (await r.json()) as {
    lastPrice?: number | null;
    change24hPct?: number | null;
  };
  return {
    price: typeof d?.lastPrice === "number" && d.lastPrice > 0 ? d.lastPrice : null,
    change24hPct:
      typeof d?.change24hPct === "number" && !Number.isNaN(d.change24hPct)
        ? d.change24hPct
        : null,
  };
}

export function useCcPrice(): CcPriceState {
  const { data } = useQuery({
    queryKey: queryKeys.party.ccPrice,
    queryFn: fetchPrice,
    // Harga tampilan — boleh stale lebih lama, tapi tetap refresh berkala.
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  return data ?? EMPTY;
}
