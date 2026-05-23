import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/twitter/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
