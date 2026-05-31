import { TransactionDetailView } from "@/components/app/wallet/transaction-detail-view";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function TransactionDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <TransactionDetailView transactionId={id} />;
}
