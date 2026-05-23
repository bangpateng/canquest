"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletSetup } from "@/components/app/wallet-setup";
import { WalletDashboard } from "@/components/app/wallet-dashboard";
import { PlatformPage } from "@/components/platform/platform-page";
import { getMe, getLedgerStatus, type LedgerStatus } from "@/lib/services/api";
import { AlertTriangle, Loader2 } from "lucide-react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

type Me = {
  username?: string | null;
  cantonPartyId?: string | null;
};

export default function WalletPage() {
  const t = usePlatformT();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatus | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [meData, status] = await Promise.allSettled([
        getMe(),
        getLedgerStatus(),
      ]);
      if (meData.status === "fulfilled") setMe(meData.value);
      if (status.status === "fulfilled") setLedgerStatus(status.value);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  const hasRealParty =
    Boolean(me?.cantonPartyId) &&
    !me?.cantonPartyId?.startsWith("canquest:user:");

  const showNodeWarning =
    ledgerStatus &&
    (!ledgerStatus.canton.reachable || !ledgerStatus.splice.reachable);

  return (
    <PlatformPage>
      {showNodeWarning ? (
        <div className="flex w-full min-w-0 items-start gap-3 rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-orange-200">{t("wallet.nodeIssue")}</p>
            <p className="mt-0.5 break-words text-orange-300/80">
              {ledgerStatus!.message}
            </p>
          </div>
        </div>
      ) : null}

      {!me?.username || !hasRealParty ? (
        <WalletSetup onCreated={refresh} />
      ) : (
        <WalletDashboard me={me} onRefresh={refresh} />
      )}
    </PlatformPage>
  );
}
