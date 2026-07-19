import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /party/wallet/otp/verify — verify OTP + execute onboarding.
 * Frontend: otp input → POST /api/party/wallet/otp/verify → response wallet data
 * → render success screen.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/wallet/otp/verify', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
