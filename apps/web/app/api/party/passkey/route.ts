import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/** GET /api/party/passkey → { hasPasskey, credentials[] }. */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/passkey', { method: 'GET' });
}
