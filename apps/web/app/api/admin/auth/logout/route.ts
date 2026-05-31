import { NextResponse } from 'next/server';

import { clearAdminAccessCookie } from '@/lib/auth/auth-cookies';

export async function POST() {
  const out = NextResponse.json({ ok: true });
  clearAdminAccessCookie(out);
  return out;
}
