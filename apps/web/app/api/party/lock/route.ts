import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /api/party/lock — kunci CC selama termKey (Spec CC Lock). */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/lock', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
