import { type NextRequest } from 'next/server';
import { nestWithAdminAccessCookie } from '@/lib/nest-proxy-admin-access';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.toString();
  const suffix = q ? `/admin/users?${q}` : '/admin/users';
  return nestWithAdminAccessCookie(req, suffix, { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAdminAccessCookie(req, '/admin/users/delete-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
