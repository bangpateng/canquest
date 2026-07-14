import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest GET /api/party/offers.
 *
 * direction query param:
 *  - default / 'incoming' → pending incoming offers (user = receiver)
 *  - 'outgoing'           → pending sent offers (user = sender, untuk Withdraw)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dir =
    searchParams.get('direction') === 'outgoing' ? 'outgoing' : 'incoming';
  return nestWithAccessCookie(req, `/party/offers?direction=${dir}`, {
    method: 'GET',
  });
}