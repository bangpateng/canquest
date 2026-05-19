import { WinnersPanel } from '@/components/admin/winners-panel';

type P = { params: Promise<{ questId: string }> };

export default async function WinnersPage({ params }: P) {
  const { questId } = await params;
  return <WinnersPanel questId={questId} />;
}
