import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** POST /api/party/sign/cancel — clear stale pending signing transaction. */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/sign/cancel', {
    method: 'POST',
  });
}
