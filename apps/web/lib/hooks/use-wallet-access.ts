"use client";

import { useCallback, useEffect, useState } from "react";
import { hasRealWallet } from "@/lib/wallet-access";

type MeWallet = {
  cantonPartyId?: string | null;
};

export function useWalletAccess() {
  const [partyId, setPartyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });
      if (!res.ok) {
        setPartyId(null);
        return;
      }
      const me = (await res.json()) as MeWallet;
      setPartyId(me.cantonPartyId?.trim() || null);
    } catch {
      setPartyId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    loading,
    partyId,
    hasWallet: hasRealWallet(partyId),
    refresh,
  };
}
