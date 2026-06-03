import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, '/admin/spin/settings', { method: 'GET' });
}

export async function PATCH(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, '/admin/spin/settings', {
    method: 'PATCH',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
