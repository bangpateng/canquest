import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/** GET /api/party/wallet-password → { hasPassword: boolean }. */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/wallet-password', { method: 'GET' });
}

/** POST /api/party/wallet-password — set or change wallet password. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/wallet-password', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** DELETE /api/party/wallet-password — remove wallet password (verify current). */
export async function DELETE(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/wallet-password', {
    method: 'DELETE',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
