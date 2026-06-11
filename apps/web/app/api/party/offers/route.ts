import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest GET /api/party/offers — lists pending incoming TransferOffers. */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/offers', { method: 'GET' });
}