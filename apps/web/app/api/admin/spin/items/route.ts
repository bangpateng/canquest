import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/auth/nest-proxy-admin-access';

export async function GET(req: NextRequest) {
  return nestWithAdminAccessCookie(req, '/admin/spin/items', { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, '/admin/spin/items', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
