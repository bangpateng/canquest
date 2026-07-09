import { getSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseAuthEnabled } from '@/lib/supabase/config';
import { setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/api/turnstile';
import { NextResponse } from 'next/server';

/**
 * Register endpoint — orkestrasi (Nest) + session (Supabase/legacy).
 *
 * Nest /auth/register selalu dipanggil untuk:
 *  - Validasi email anti-sybil (disposable blocklist + webmail allowlist).
 *  - Resolve referral code.
 *  - Buat row User lokal (cuid) + link authUserId.
 *  - (Mode Supabase) createUser di auth.users Supabase via admin API.
 *
 * Setelah Nest sukses:
 *  - Mode Supabase + skipOtp (email_confirm=true): signInWithPassword untuk
 *    dapat session, set cookie sb-*.
 *  - Mode Supabase + OTP: frontend redirect ke halaman verifikasi Supabase.
 *  - Mode legacy: set cookie cq_* dari token yang Nest issue.
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

  // Mode legacy: Nest issue token, set cookie cq_*.
  if (!isSupabaseAuthEnabled()) {
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

  // Mode Supabase: jika email langsung confirmed (skipOtp), dapatkan session.
  if (data.emailConfirmed === true) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: nestBody.email!,
      password: nestBody.password!,
    });
    if (error) {
      // Row User sudah dibuat tapi gagal auto-login — minta user login manual.
      return NextResponse.json({
        ...data,
        warning: 'Account created. Please sign in.',
      });
    }
    return NextResponse.json({ ok: true, ...data });
  }

  // Mode Supabase + OTP: frontend harus handle verifikasi email Supabase.
  return NextResponse.json(data);
}
