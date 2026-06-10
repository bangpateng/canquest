"use client";

import { useParams } from "next/navigation";
import { TransactionDetailView } from "@/components/app/wallet/transaction-detail-view";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <PlatformPage>
      <PlatformPageIntro
        title="Transaction Detail"
        description="On-chain receipt and Canton settlement status"
      />
      <TransactionDetailView transactionId={id} />
    </PlatformPage>
  );
}