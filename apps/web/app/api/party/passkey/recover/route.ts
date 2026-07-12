import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/** POST /api/party/passkey/recover → backup code verification (device lost recovery). */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/passkey/recover', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
