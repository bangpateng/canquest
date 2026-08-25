import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** POST /api/party/sign/preapproval/prepare — prepare preapproval via validator API. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/sign/preapproval/prepare', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  }, { upstreamTimeoutMs: 60_000 });
}
