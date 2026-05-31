import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return nestWithAccessCookie(req, `/party/transactions/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}
