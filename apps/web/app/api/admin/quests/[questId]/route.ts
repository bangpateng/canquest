import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';
type P = { params: Promise<{ questId: string }> };
export async function GET(req: NextRequest, { params }: P) {
  const { questId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/quests/${questId}`, { method: 'GET' });
}
export async function PATCH(req: NextRequest, { params }: P) {
  const { questId } = await params;
  const body = await req.text();
  return nestWithAdminAccessCookie(req, `/admin/quests/${questId}`, { method: 'PATCH', body, headers: { 'Content-Type': 'application/json' } });
}
export async function DELETE(req: NextRequest, { params }: P) {
  const { questId } = await params;
  return nestWithAdminAccessCookie(req, `/admin/quests/${questId}`, { method: 'DELETE' });
}
