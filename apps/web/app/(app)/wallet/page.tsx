"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletSetup } from "@/components/app/wallet-setup";
import { WalletDashboard } from "@/components/app/wallet-dashboard";
import { Loader2 } from "lucide-react";

type Me = {
  username?: string | null;
  cantonPartyId?: string | null;
};

export default function WalletPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });
    if (res.ok) setMe((await res.json()) as Me);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  const hasRealParty =
    Boolean(me?.cantonPartyId) && !me?.cantonPartyId?.startsWith("canquest:user:");

  if (!me?.username || !hasRealParty) {
    return <WalletSetup onCreated={refresh} />;
  }

  return <WalletDashboard me={me} onRefresh={refresh} />;
}
