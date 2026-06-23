import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /api/party/unlock — unlock satu LockedAmulet milik user (Spec CC Lock). */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/unlock', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
