import { getSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseAuthEnabled } from '@/lib/supabase/config';
import { clearAuthCookies, setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/api/turnstile';
import { NextResponse } from 'next/server';

/**
 * Login endpoint.
 *
 * Mode Supabase (SUPABASE_AUTH_ENABLED):
 *  - Verifikasi Turnstile (anti-bot, tetap server-side).
 *  - supabase.auth.signInWithPassword() → @supabase/ssr auto-set cookie sb-*.
 *  - Nest TIDAK di-callback di sini; session diverifikasi di guard Nest via
 *    access token Supabase yang dikirim BFF proxy.
 *
 * Mode legacy (rollback):
 *  - Forward ke Nest /auth/login, set cookie cq_access/cq_refresh.
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

  if (!isSupabaseAuthEnabled()) {
    // Legacy path → forward ke Nest, set cookie cq_*.
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

  // ── Mode Supabase ──────────────────────────────────────────────────────
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return NextResponse.json(
      { message: error?.message ?? 'Invalid email or password' },
      { status: 401 },
    );
  }

  // Bersihkan cookie legacy kalau ada (user re-login setelah migrasi).
  const out = NextResponse.json({ ok: true });
  clearAuthCookies(out);
  return out;
}
