import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /api/party/accept-offer — accepts a pending TransferOffer. */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/accept-offer', { method: 'POST' });
}