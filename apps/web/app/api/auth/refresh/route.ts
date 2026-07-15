import { CQ_REFRESH_COOKIE, setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Refresh session — tukar cq_refresh cookie ke Nest untuk token baru,
 * set cookie cq_* dari response.
 */
export async function POST(req: NextRequest) {
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
