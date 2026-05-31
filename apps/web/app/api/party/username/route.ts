import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /api/party/username — reserve username + placeholder party ID. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/username', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
