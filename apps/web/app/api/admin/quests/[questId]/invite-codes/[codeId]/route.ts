import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/nest-proxy-admin-access';

type P = { params: Promise<{ questId: string; codeId: string }> };

export async function DELETE(req: NextRequest, { params }: P) {
  const { questId, codeId } = await params;
  return nestWithAdminAccessCookie(
    req,
    `/admin/quests/${questId}/invite-codes/${codeId}`,
    { method: 'DELETE' },
  );
}
