import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/** POST /api/party/passkey/backup/regenerate → re-issue 10 backup codes (gated). */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/passkey/backup/regenerate', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
