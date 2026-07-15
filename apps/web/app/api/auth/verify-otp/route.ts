import { setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { NextResponse } from 'next/server';

/**
 * Verify OTP (email confirmation code) — forward ke Nest /auth/verify-otp,
 * set cookie cq_* dari token yang Nest issue.
 */
export async function POST(req: Request) {
  let body: { userId?: string; code?: string };
  try {
    body = (await req.json()) as { userId?: string; code?: string };
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/verify-otp',
    body,
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
