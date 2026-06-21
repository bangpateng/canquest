import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qs = new URLSearchParams({ limit: searchParams.get('limit') ?? '12' });
  return nestWithAccessCookie(req, `/party/notifications?${qs.toString()}`, {
    method: 'GET',
  });
}
