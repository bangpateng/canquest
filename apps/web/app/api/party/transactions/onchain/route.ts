import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get('limit') ?? '15';
  const cursor = searchParams.get('cursor') ?? '';
  const cursorParam = cursor ? `&cursor=${cursor}` : '';
  return nestWithAccessCookie(
    req,
    `/party/transactions/onchain?limit=${limit}${cursorParam}`,
    { method: 'GET' },
  );
}
