import {
  CQ_REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { type NextRequest, NextResponse } from 'next/server';

function sessionExpiredResponse(): NextResponse {
  const out = NextResponse.json(
    { ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' },
    { status: 401 },
  );
  clearAuthCookies(out);
  return out;
}

/**
 * Refresh session: tukar cq_refresh cookie ke Nest untuk token baru dan
 * rotasi cookie cq_*. Cookie hanya dibersihkan ketika refresh ditolak final.
 */
export async function POST(req: NextRequest) {
  const refresh = req.cookies.get(CQ_REFRESH_COOKIE)?.value;
  if (!refresh) {
    return sessionExpiredResponse();
  }

  try {
    const { res, data } = await postJsonParse<Record<string, unknown>>(
      '/auth/refresh',
      { refreshToken: refresh },
    );

    if (res.status === 401 || res.status === 403) {
      return sessionExpiredResponse();
    }

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    if (
      typeof data.accessToken !== 'string' ||
      typeof data.refreshToken !== 'string'
    ) {
      return NextResponse.json(
        { ok: false, message: 'Authentication service returned an invalid response' },
        { status: 502 },
      );
    }

    const out = NextResponse.json({ ok: true });
    setAuthCookies(out, data.accessToken, data.refreshToken);
    return out;
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Authentication service temporarily unavailable' },
      { status: 502 },
    );
  }
}
