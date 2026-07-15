import { setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/api/turnstile';
import { NextResponse } from 'next/server';

/**
 * Login endpoint — forward ke Nest /auth/login, set cookie cq_access/cq_refresh.
 */
export async function POST(req: Request) {
  let body: { email?: string; password?: string; turnstileToken?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const captcha = await verifyTurnstileToken(
    body.turnstileToken,
    clientIpFromRequest(req),
  );
  if (!captcha.ok) return captcha.response;

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) {
    return NextResponse.json({ message: 'Email and password required' }, { status: 400 });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/login',
    { email, password },
  );
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  if (data.needsVerification === true && typeof data.userId === 'string') {
    return NextResponse.json(data);
  }
  const out = NextResponse.json({ ok: true });
  if (
    typeof data.accessToken === 'string' &&
    typeof data.refreshToken === 'string'
  ) {
    setAuthCookies(out, data.accessToken, data.refreshToken);
  }
  return out;
}
