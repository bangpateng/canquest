import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest GET /api/party/preapproval-status */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/preapproval-status', { method: 'GET' });
}
