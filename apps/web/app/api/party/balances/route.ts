import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/balances', { method: 'GET' });
}
