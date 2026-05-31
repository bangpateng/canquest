import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /api/party/allocate — allocates a real Canton Party via JSON Ledger API. */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/allocate', { method: 'POST' });
}
