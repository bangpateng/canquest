import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /party/wallet/otp/send — issue OTP for wallet creation.
 * Frontend: form → POST /api/party/wallet/otp/send → response { expiresAt } →
 * render OTP input screen.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/wallet/otp/send', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
