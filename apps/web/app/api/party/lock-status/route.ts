import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest GET /api/party/lock-status — status lock user (tier, lockedCc, activeLocks). */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/lock-status', { method: 'GET' });
}
