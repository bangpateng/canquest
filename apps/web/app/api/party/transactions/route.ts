import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = searchParams.get('page') ?? '1';
  const pageSize = searchParams.get('pageSize') ?? '10';
  return nestWithAccessCookie(req, `/party/transactions?page=${page}&pageSize=${pageSize}`, {
    method: 'GET',
  });
}
