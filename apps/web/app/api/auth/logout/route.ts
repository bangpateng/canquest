import { NextResponse } from 'next/server';

import { clearAuthCookies } from '@/lib/auth/auth-cookies';

/** Logout: clear semua auth cookie cq_*. */
export async function POST() {
  const out = NextResponse.json({ ok: true });
  clearAuthCookies(out);
  return out;
}
