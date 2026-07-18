import { NextResponse } from 'next/server';

export const CQ_ACCESS_COOKIE = 'cq_access';
export const CQ_REFRESH_COOKIE = 'cq_refresh';

/** Separate session for `/admin` (env-backed email + password — not app users). */
export const CQ_ADMIN_ACCESS_COOKIE = 'cq_admin_access';

const COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  path: '/' as const,
  secure: process.env.NODE_ENV === 'production',
};

const ACCESS_MAX_AGE = 15 * 60;
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;
/** Matches Nest JWT `expiresIn` for admin panel tokens. */
const ADMIN_PANEL_ACCESS_MAX_AGE = 8 * 60 * 60;

export function setAdminAccessCookie(response: NextResponse, accessToken: string): void {
  response.cookies.set(CQ_ADMIN_ACCESS_COOKIE, accessToken, {
    ...COOKIE_OPTS,
    maxAge: ADMIN_PANEL_ACCESS_MAX_AGE,
  });
}

export function clearAdminAccessCookie(response: NextResponse): void {
  response.cookies.set(CQ_ADMIN_ACCESS_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
}
export function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  response.cookies.set(CQ_ACCESS_COOKIE, accessToken, {
    ...COOKIE_OPTS,
    maxAge: ACCESS_MAX_AGE,
  });
  response.cookies.set(CQ_REFRESH_COOKIE, refreshToken, {
    ...COOKIE_OPTS,
    maxAge: REFRESH_MAX_AGE,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(CQ_ACCESS_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  response.cookies.set(CQ_REFRESH_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
}

type TokenBearer = {
  accessToken?: unknown;
  refreshToken?: unknown;
};

export function tryApplyAuthCookies(
  response: NextResponse,
  body: TokenBearer,
): boolean {
  if (typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string') {
    return false;
  }
  setAuthCookies(response, body.accessToken, body.refreshToken);
  return true;
}

/** Use after Nest login / refresh / verify-otp succeeds. Never returns `{ ok: true }` unless cookies were set. */
export function okWithSessionCookiesOr502(data: Record<string, unknown>): NextResponse {
  const out = NextResponse.json({ ok: true });
  if (tryApplyAuthCookies(out, data)) return out;

  const devHint =
    process.env.NODE_ENV === 'development'
      ? { hint: `API response keys: ${Object.keys(data).join(', ') || '(empty)'}` }
      : {};

  return NextResponse.json(
    {
      message:
        'Session could not be created (missing tokens). Check that apps/api is running and INTERNAL_API_URL points to Nest.',
      ...devHint,
    },
    { status: 502 },
  );
}
