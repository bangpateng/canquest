"use client";

import { TransactionsView } from "@/components/app/wallet/transactions-view";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";

export default function TransactionsListPage() {
  return (
    <PlatformPage>
      <PlatformPageIntro
        title="Transaction History"
        description="All your on-chain activity in one place"
      />
      <TransactionsView />
    </PlatformPage>
  );
}