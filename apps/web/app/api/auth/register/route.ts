import { setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/api/turnstile';
import { NextResponse } from 'next/server';

/**
 * Register endpoint — forward ke Nest /auth/register, set cookie cq_*.
 *
 * Nest orkestrasi: validasi email anti-sybil, referral, displayName, buat row
 * User + bcrypt hash. OTP verifikasi via Resend email. Setelah Nest sukses,
 * set cookie cq_access/cq_refresh dari token yang Nest issue (kalau skipOtp)
 * atau return { userId, message } untuk lanjut OTP flow.
 */
export async function POST(req: Request) {
  let body: {
    email?: string;
    password?: string;
    referralCode?: string;
    turnstileToken?: string;
  };
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

  const { turnstileToken: _t, ...nestBody } = body;
  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/register',
    nestBody,
  );

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  // Nest issue token (kalau skipOtp), set cookie cq_*.
  if (
    typeof data.accessToken === 'string' &&
    typeof data.refreshToken === 'string'
  ) {
    const out = NextResponse.json({ ok: true });
    setAuthCookies(out, data.accessToken, data.refreshToken);
    return out;
  }
  return NextResponse.json(data);
}
