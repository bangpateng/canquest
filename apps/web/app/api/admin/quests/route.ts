import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/nest-proxy-admin-access';
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind');
  const path = kind ? `/admin/quests?kind=${encodeURIComponent(kind)}` : '/admin/quests';
  return nestWithAdminAccessCookie(req, path, { method: 'GET' });
}
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, '/admin/quests', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
}