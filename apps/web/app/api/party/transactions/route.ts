import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qs = new URLSearchParams({
    page: searchParams.get('page') ?? '1',
    pageSize: searchParams.get('pageSize') ?? '10',
  });
  return nestWithAccessCookie(req, `/party/transactions?${qs.toString()}`, {
    method: 'GET',
  });
}
