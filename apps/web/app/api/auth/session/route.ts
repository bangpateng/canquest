import { type NextRequest, NextResponse } from 'next/server';

import { CQ_ACCESS_COOKIE } from '@/lib/auth/auth-cookies';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/**
 * Lightweight session probe for marketing/landing (Launch App).
 * Always 200 — guests get { loggedIn: false } without calling Nest or returning 401.
 * Does not expose profile fields; use GET /api/me when the app needs user data.
 *
 * Cek cq_access cookie lalu verifikasi ke Nest /auth/me.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(CQ_ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { loggedIn: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const upstream = await nestWithAccessCookie(req, '/auth/me', { method: 'GET' });
  if (!upstream.ok) {
    return NextResponse.json(
      { loggedIn: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { loggedIn: true },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
