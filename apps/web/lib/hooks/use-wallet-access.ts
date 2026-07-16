"use client";

import { useCallback } from "react";
import { hasRealWallet } from "@/lib/auth/wallet-access";
import { useMe } from "@/lib/hooks/use-me";

type MeWallet = {
  cantonPartyId?: string | null;
};

/**
 * Apakah user sudah punya wallet Canton (partyId real, bukan placeholder
 * `canquest:`). Dipasang global di PlatformShell → cache `useMe` ter-warm
 * di semua halaman platform (lihat `lib/hooks/use-me.ts`).
 *
 * Sebelumnya memfetch `/api/me` manual; sekarang re-use `useMe()` sehingga
 * request ter-dedup dengan konsumen `/api/me` lain.
 */
export function useWalletAccess() {
  const { me, isLoading, refetch } = useMe();
  const partyId = me?.cantonPartyId?.trim() || null;

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    loading: isLoading,
    partyId,
    hasWallet: hasRealWallet(partyId),
    refresh,
  };
}

export type { MeWallet };
