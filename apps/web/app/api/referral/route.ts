import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  return nestWithAccessCookie(req, '/referral/me', {
    method: 'GET',
    headers: { 'x-site-origin': origin },
  });
}
