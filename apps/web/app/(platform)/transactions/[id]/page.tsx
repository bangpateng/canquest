"use client";

import { useParams } from "next/navigation";
import { TransactionDetailView } from "@/components/app/wallet/transaction-detail-view";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";

export default function TransactionDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <PlatformPage>
      <PlatformPageIntro/>
      <TransactionDetailView transactionId={id} />
    </PlatformPage>
  );
}