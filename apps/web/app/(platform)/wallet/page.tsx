"use client";

import { useCallback, useEffect, useState } from "react";
import { WalletSetup } from "@/components/app/wallet/wallet-setup";
import { WalletDashboard } from "@/components/app/wallet/wallet-dashboard";
import { WalletReconnect } from "@/components/app/wallet/wallet-reconnect";
import { PlatformPage } from "@/components/platform/platform-page";
import { getLedgerStatus, type LedgerStatus } from "@/lib/services/api";
import { useMe } from "@/lib/hooks/use-me";
import { useInvalidateWalletTokens } from "@/lib/hooks/use-wallet-tokens";
import {
  cacheWalletMe,
  hasUsableWalletCache,
  isRealCantonPartyId,
  readCachedWalletMe,
  readLastWalletUserId,
} from "@/lib/auth/wallet-session-cache";
import { AlertTriangle } from "lucide-react";
import { PageLoading } from "@/components/ui/loading-spinner";
import { usePlatformT } from "@/lib/i18n/platform-provider";

type Me = {
  id?: string;
  username?: string | null;
  cantonPartyId?: string | null;
};

export default function WalletPage() {
  const t = usePlatformT();
  // Profil via cache global `useMe` — tidak mengeblok render: shell/skeleton
  // tampil saat data masih loading. Sebelumnya `await getMe()` (timeout 8s)
  // memblok seluruh subtree wallet.
  const { me: meData, isLoading: meLoading, isError: meError, refetch } = useMe();
  const [me, setMe] = useState<Me | null>(null);
  const [profileStale, setProfileStale] = useState(false);
  const [ledgerStatus, setLedgerStatus] = useState<LedgerStatus | null>(null);
  const invalidateWalletTokens = useInvalidateWalletTokens();

  // Sinkronkan data hook → state lokal (mirip implementasi lama, agar logika
  // cache/profileStale tetap utuh).
  useEffect(() => {
    if (meData) {
      setMe(meData);
      cacheWalletMe(meData);
      setProfileStale(false);
    } else if (meError) {
      const lastUserId = readLastWalletUserId();
      const cached = readCachedWalletMe(lastUserId);
      setMe((prev) => {
        if (prev?.id && prev.id === cached?.userId) return prev;
        if (cached) return cached;
        if (prev && !isRealCantonPartyId(prev.cantonPartyId) && !prev.username) return prev;
        return null;
      });
      if (hasUsableWalletCache(lastUserId)) setProfileStale(true);
    }
  }, [meData, meError]);

  const refresh = useCallback(async () => {
    // Refresh paralel: profil (useMe) + ledger + token pools/balances.
    void getLedgerStatus()
      .then(setLedgerStatus)
      .catch(() => {
        /* node check is advisory — never block wallet UI */
      });
    void invalidateWalletTokens();
    await refetch();
  }, [refetch, invalidateWalletTokens]);

  useEffect(() => {
    // Ledger check di-fire sekali saat mount (advisory, non-blocking).
    void getLedgerStatus()
      .then(setLedgerStatus)
      .catch(() => {
        /* node check is advisory — never block wallet UI */
      });
  }, []);

  // FIX bug flash: saat profil masih loading (useMe belum resolve), JANGAN
  // fallback ke <WalletSetup> (form buat-wallet). Tampilkan skeleton sampai
  // data resolve. Sebelumnya, user yang sudah punya wallet melihat flash form
  // buat-wallet selama ~200-500ms saat refresh → UX confusing + bisa trigger
  // double-create.
  //
  // Cache sessionStorage dipakai HANYA untuk skip skeleton kalau user benar2
  // sudah punya wallet (instant render). Tanpa cache → tunggu /api/me resolve.
  const cachedUsable = hasUsableWalletCache(readLastWalletUserId());
  if (meLoading && !cachedUsable && !me) {
    return <PageLoading minHeight="min-h-[60vh]" />;
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
        <div className="flex w-full min-w-0 items-start gap-3 rounded-3xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 backdrop-blur-xl">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-amber-200">{t("wallet.profileStale")}</p>
            <p className="mt-1 break-words text-sm font-medium text-amber-300/70">
              {t("wallet.profileStaleHint")}
            </p>
          </div>
        </div>
      ) : null}

      {showNodeWarning ? (
        <div className="flex w-full min-w-0 items-start gap-3 rounded-3xl border border-orange-500/20 bg-orange-500/5 px-5 py-4 backdrop-blur-xl">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-orange-200">{t("wallet.nodeIssue")}</p>
            <p className="mt-1 break-words text-sm font-medium text-orange-300/70">
              {ledgerStatus!.message}
            </p>
          </div>
        </div>
      ) : null}

      {/* Render branch: hanya ke WalletSetup kalau profil SUDAH resolve tapi
          user emang belum punya wallet. Loading = skeleton (di atas), bukan form. */}
      {!hasUsername || !me ? (
        me ? (
          <WalletSetup onCreated={refresh} />
        ) : (
          <PageLoading minHeight="min-h-[60vh]" />
        )
      ) : isPlaceholder ? (
        // isPlaceholder implies username exists (set during onboarding step).
        <WalletReconnect username={me.username!} onConnected={refresh} />
      ) : hasRealParty && me ? (
        <WalletDashboard me={me} onRefresh={refresh} />
      ) : (
        <WalletSetup onCreated={refresh} />
      )}
    </PlatformPage>
  );
}
