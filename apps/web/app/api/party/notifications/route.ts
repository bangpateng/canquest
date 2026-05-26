import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get('limit') ?? '12';
  return nestWithAccessCookie(req, `/party/notifications?limit=${limit}`, {
    method: 'GET',
  });
}
