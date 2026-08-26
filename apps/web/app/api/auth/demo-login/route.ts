import { setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { NextResponse } from 'next/server';

/**
 * DEMO-ONLY route — membuat sesi login untuk perekaman video demo.
 *
 * Guard: query ?k= harus cocok dengan env DEMO_LOGIN_KEY. Kredensial akun
 * demo (DEMO_LOGIN_EMAIL / DEMO_LOGIN_PASSWORD) tidak pernah keluar server.
 * Route ini DIHAPUS setelah video demo selesai.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('k') ?? '';
  const expected = process.env.DEMO_LOGIN_KEY?.trim();
  if (!expected || key !== expected) {
    return NextResponse.redirect(new URL('/', url.origin), 302);
  }
  const email = process.env.DEMO_LOGIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEMO_LOGIN_PASSWORD;
  if (!email || !password) {
    return NextResponse.json({ message: 'not configured' }, { status: 404 });
  }
  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/login',
    { email, password },
  );
  if (
    !res.ok ||
    typeof data.accessToken !== 'string' ||
    typeof data.refreshToken !== 'string'
  ) {
    return NextResponse.json({ message: 'login failed' }, { status: 403 });
  }
  const out = NextResponse.redirect(new URL('/overview', url.origin), 302);
  setAuthCookies(out, data.accessToken, data.refreshToken);
  return out;
}
