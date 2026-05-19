import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/nest-proxy-admin-access';
export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, '/admin/quests', { method: 'GET' });
}
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, '/admin/quests', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
}