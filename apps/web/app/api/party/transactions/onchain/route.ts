import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qs = new URLSearchParams({ limit: searchParams.get('limit') ?? '15' });
  const cursor = searchParams.get('cursor');
  if (cursor) qs.set('cursor', cursor);
  return nestWithAccessCookie(req, `/party/transactions/onchain?${qs.toString()}`, {
    method: 'GET',
  });
}
