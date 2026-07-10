import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/swap', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
