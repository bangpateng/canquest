import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest GET /api/party/ledger-status — checks Canton JSON API reachability. */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/ledger-status', { method: 'GET' });
}
