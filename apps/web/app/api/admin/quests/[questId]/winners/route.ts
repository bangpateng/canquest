import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';
type P = { params: Promise<{ questId: string }> };
export async function GET(req: NextRequest, { params }: P) {
  const { questId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/quests/${questId}/winners`, { method: 'GET' });
}
