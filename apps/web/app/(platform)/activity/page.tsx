"use client";

import { TransactionsView } from "@/components/app/wallet/transactions-view";
import { PlatformPage } from "@/components/platform/platform-page";
import { useMe } from "@/lib/hooks/use-me";

export default function ActivityListPage() {
  // partyId via cache global `useMe` — tidak mengeblok render. TransactionsView
  // punya gate `enabled: Boolean(partyId)`; saat cache hangat (di-warm platform-
  // shell), transaksi langsung fetch tanpa waterfall `/api/me` → transaksi.
  const { me } = useMe();
  const partyId = me?.cantonPartyId ?? null;

  return (
    <PlatformPage>
      <TransactionsView partyId={partyId} />
    </PlatformPage>
  );
}
