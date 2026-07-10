"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TokenDetailView } from "@/components/app/wallet/token-detail-view";
import { PlatformPage } from "@/components/platform/platform-page";
import { getMe } from "@/lib/services/api";
import {
  cacheWalletMe,
  readCachedWalletMe,
} from "@/lib/auth/wallet-session-cache";
import { PageLoading } from "@/components/ui/loading-spinner";

type Me = {
  id?: string;
  username?: string | null;
  cantonPartyId?: string | null;
};

export default function WalletTokenPage() {
  const { tokenId } = useParams<{ tokenId: string }>();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const meData = await getMe();
      setMe(meData);
      cacheWalletMe(meData);
    } catch {
      // Fallback ke cache bila fetch gagal.
      const cached = readCachedWalletMe();
      if (cached) setMe(cached);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !me) {
    return (
      <PlatformPage>
        <PageLoading />
      </PlatformPage>
    );
  }

  return (
    <PlatformPage>
      {me ? (
        <TokenDetailView tokenId={tokenId} me={me} />
      ) : (
        <p className="text-center text-sm text-slate-400">
          Unable to load wallet. Please refresh.
        </p>
      )}
    </PlatformPage>
  );
}
