import { CQ_REFRESH_COOKIE, setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { isSupabaseAuthEnabled } from '@/lib/supabase/config';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Refresh session.
 *
 * Mode Supabase: refresh di-handle otomatis oleh middleware (updateSession),
 * endpoint ini no-op (return ok) — dipertahankan agar caller lama tidak 404.
 * Mode legacy: tukar cq_refresh cookie ke Nest untuk token baru.
 */
export async function POST(req: NextRequest) {
  if (isSupabaseAuthEnabled()) {
    return NextResponse.json({ ok: true });
  }

  const refresh = req.cookies.get(CQ_REFRESH_COOKIE)?.value;
  if (!refresh) {
    return NextResponse.json({ message: 'Missing refresh token' }, { status: 401 });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/refresh',
    { refreshToken: refresh },
  );

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
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
