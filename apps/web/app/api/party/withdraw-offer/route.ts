import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /api/party/withdraw-offer — withdraws a pending TransferOffer as sender. */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/withdraw-offer', { method: 'POST' });
}