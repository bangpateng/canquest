import { QuestDetail } from '@/components/admin/quest-detail';

type P = { params: Promise<{ questId: string }> };

export default async function AdminQuestPage({ params }: P) {
  const { questId } = await params;
  return <QuestDetail questId={questId} />;
}
