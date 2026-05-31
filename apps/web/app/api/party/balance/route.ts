import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest GET /api/party/balance — returns live CC balance from Splice Wallet API. */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/balance', { method: 'GET' });
}
