import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/nest-proxy-admin-access';
type P = { params: Promise<{ questId: string }> };
export async function GET(req: NextRequest, { params }: P) {
  const { questId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/quests/${questId}/invite-codes`, { method: 'GET' });
}
export async function POST(req: NextRequest, { params }: P) {
  const { questId } = await params;
  const body = await req.text();
  return nestWithAdminAccessCookie(req, `/admin/quests/${questId}/invite-codes`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
}
