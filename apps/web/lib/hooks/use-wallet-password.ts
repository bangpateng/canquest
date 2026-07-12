"use client";

import { useCallback, useEffect, useState } from "react";

type UseWalletPasswordOptions = {
  /** When false, no fetch (e.g. user has no wallet yet). */
  enabled?: boolean;
};

/**
 * Apakah user telah menetapkan kata sandi transaksi (wallet password) di Settings.
 * Dipakai Send / Lock / Unlock untuk memutuskan apakah modal konfirmasi perlu
 * ditampilkan sebelum eksekusi.
 *
 * Sumber: GET /api/party/wallet-password → { hasPassword: boolean }.
 */
export function useWalletPassword(options: UseWalletPasswordOptions = {}) {
  const { enabled = true } = options;
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/party/wallet-password", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { hasPassword?: boolean };
        setHasPassword(!!data.hasPassword);
      }
    } catch {
      // Non-fatal: default false (tidak ada gate).
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  return { hasPassword, loading, refresh, setHasPassword };
}
