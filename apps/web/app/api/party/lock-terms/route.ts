import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest GET /api/party/lock-terms — daftar pilihan term dari LOCK_TERM_OPTIONS. */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/lock-terms', { method: 'GET' });
}
