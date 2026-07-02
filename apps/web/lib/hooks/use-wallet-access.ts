"use client";

import { hasRealWallet } from "@/lib/auth/wallet-access";
import { useMe } from "@/lib/hooks/use-me";

/**
 * Party ID + wallet status from the shared `/api/me` cache (useMe).
 *
 * Sebelumnya fetch /api/me mentah sendiri; sekarang re-use cache useMe supaya
 * /api/me dipanggil sekali untuk semua komponen (mengurangi beban Vercel).
 */
export function useWalletAccess() {
  const { me, loading, refresh } = useMe();
  const partyId = me?.cantonPartyId?.trim() || null;

  return {
    loading,
    partyId,
    hasWallet: hasRealWallet(partyId),
    refresh,
  };
}
