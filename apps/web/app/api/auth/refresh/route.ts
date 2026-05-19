import { CQ_REFRESH_COOKIE, okWithSessionCookiesOr502 } from '@/lib/auth-cookies';
import { postJsonParse } from '@/lib/internal-api-url';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const refresh = req.cookies.get(CQ_REFRESH_COOKIE)?.value;
  if (!refresh) {
    return NextResponse.json({ message: 'Missing refresh token' }, { status: 401 });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>('/auth/refresh', {
    refreshToken: refresh,
  });

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return okWithSessionCookiesOr502(data);
}
