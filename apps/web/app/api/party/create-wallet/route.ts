import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /api/party/create-wallet — alias untuk /allocate.
 *
 * Endpoint create-wallet yang lebih jelas namanya (semantik REST-friendly).
 * Logic identik dengan /allocate (allocateCantonParty), cuma beda nama route.
 */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/create-wallet', { method: 'POST' });
}
