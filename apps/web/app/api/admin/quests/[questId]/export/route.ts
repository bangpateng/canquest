import { type NextRequest } from 'next/server';

import { nestWithAdminAccessCookie } from '@/lib/nest-proxy-admin-access';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ questId: string }> },
) {
  const { questId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/quests/${questId}/export`, { method: 'GET' });
}
