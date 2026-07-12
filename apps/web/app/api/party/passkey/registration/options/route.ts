import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/** POST /api/party/passkey/registration/options → WebAuthn challenge. */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/passkey/registration/options', {
    method: 'POST',
  });
}
