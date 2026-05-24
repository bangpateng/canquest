"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletSetup } from "@/components/app/wallet-setup";
import { WalletDashboard } from "@/components/app/wallet-dashboard";
import { WalletReconnect } from "@/components/app/wallet-reconnect";
import { PlatformPage } from "@/components/platform/platform-page";
import { getMe, getLedgerStatus, type LedgerStatus } from "@/lib/services/api";
import {
  cacheWalletMe,
  hasUsableWalletCache,
  isRealCantonPartyId,
  readCachedWalletMe,
} from "@/lib/wallet-session-cache";
import { AlertTriangle, Loader2 } from "lucide-react";
import { usePlatformT } from "@/lib/i18n/platform-provider";

type Me = {
  username?: string | null;
  cantonPartyId?: string | null;
};

function initialMe(): Me | null {
  return readCachedWalletMe();
}

function shouldShowInitialLoader(): boolean {
  return !hasUsableWalletCache();
}

export default function WalletPage() {
  const t = usePlatformT();
  const [me, setMe] = useState<Me | null>(initialMe);
  const [loading, setLoading] = useState(shouldShowInitialLoader);
  const [profileStale, setProfileStale] = useState(false);
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatus | null>(null);

  const refresh = useCallback(async () => {
    const canShowWalletWithoutWait =
      isRealCantonPartyId(me?.cantonPartyId) || hasUsableWalletCache();
    if (!canShowWalletWithoutWait) setLoading(true);

    void getLedgerStatus()
      .then(setLedgerStatus)
      .catch(() => {
        /* node check is advisory — never block wallet UI */
      });

    try {
      const meData = await getMe();
      setMe(meData);
      cacheWalletMe(meData);
      setProfileStale(false);
    } catch {
      setMe((prev) => {
        if (isRealCantonPartyId(prev?.cantonPartyId)) return prev;
        const cached = readCachedWalletMe();
        return cached ?? prev;
      });
      if (hasUsableWalletCache()) setProfileStale(true);
    } finally {
      setLoading(false);
    }
  }, [me?.cantonPartyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !me) {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  const partyId = me?.cantonPartyId;
  const hasUsername = Boolean(me?.username);
  const hasRealParty = isRealCantonPartyId(partyId);
  const isPlaceholder = Boolean(partyId?.startsWith("canquest:"));

  const showNodeWarning =
    ledgerStatus &&
    (!ledgerStatus.canton.reachable || !ledgerStatus.splice.reachable);

  return (
    <PlatformPage>
      {profileStale ? (
        <div className="flex w-full min-w-0 items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-amber-200">{t("wallet.profileStale")}</p>
            <p className="mt-0.5 break-words text-amber-300/80">
              {t("wallet.profileStaleHint")}
            </p>
          </div>
        </div>
      ) : null}

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

      {!hasUsername ? (
        <WalletSetup onCreated={refresh} />
      ) : isPlaceholder ? (
        <WalletReconnect username={me!.username!} onConnected={refresh} />
      ) : hasRealParty && me ? (
        <WalletDashboard me={me} onRefresh={refresh} />
      ) : (
        <WalletSetup onCreated={refresh} />
      )}
    </PlatformPage>
  );
}
