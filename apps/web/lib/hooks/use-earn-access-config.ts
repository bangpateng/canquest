"use client";

import { useEffect, useState } from "react";

export interface EarnAccessConfig {
  /** Biaya poin untuk ikut satu campaign Earn (jalur points). */
  entryCostPoints: number;
  /** Jumlah CC yang harus di-lock untuk jalur cc_lock. */
  ccLockAmount: number;
}

const DEFAULT_CONFIG: EarnAccessConfig = {
  entryCostPoints: 200,
  ccLockAmount: 30,
};

/**
 * Fetch konfigurasi gate Earn dari /api/earn/access-config.
 * Dipakai oleh card guide untuk menampilkan biaya points + jumlah CC lock terkini.
 * Tidak butuh auth (endpoint publik).
 */
export function useEarnAccessConfig() {
  const [config, setConfig] = useState<EarnAccessConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/earn/access-config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : DEFAULT_CONFIG))
      .then((data: EarnAccessConfig) => {
        if (cancelled) return;
        setConfig({
          entryCostPoints:
            Number.isFinite(data.entryCostPoints) && data.entryCostPoints > 0
              ? data.entryCostPoints
              : DEFAULT_CONFIG.entryCostPoints,
          ccLockAmount:
            Number.isFinite(data.ccLockAmount) && data.ccLockAmount > 0
              ? data.ccLockAmount
              : DEFAULT_CONFIG.ccLockAmount,
        });
      })
      .catch(() => {
        /* keep default */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
