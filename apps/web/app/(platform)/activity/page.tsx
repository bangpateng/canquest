"use client";

import { useEffect, useState } from "react";
import { TransactionsView } from "@/components/app/wallet/transactions-view";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";
import { getMe } from "@/lib/services/api";

export default function ActivityListPage() {
  const [partyId, setPartyId] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((me) => setPartyId(me.cantonPartyId ?? null))
      .catch(() => setPartyId(null));
  }, []);

  return (
    <PlatformPage>
      <PlatformPageIntro title="Activity" />
      <TransactionsView partyId={partyId} />
    </PlatformPage>
  );
}
