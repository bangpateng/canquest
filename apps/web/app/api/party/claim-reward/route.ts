import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/claim-reward', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
