import { type NextRequest, NextResponse } from 'next/server';

import { CQ_ACCESS_COOKIE } from '@/lib/auth-cookies';

// ─── Hostname constants ───────────────────────────────────────────────────────
const MARKETING_HOST = 'canquest.cc';
const APP_HOST = 'app.canquest.cc';

// Routes that belong to the dapp — never served from the marketing domain
const APP_ROUTE_PATTERN =
  /^\/(dashboard|quests|leaderboard|spin|wallet|transactions|settings|login|register|verify-otp)(\/|$)/;

// Routes that require an auth cookie
const PROTECTED_PATTERN =
  /^\/(dashboard|quests|leaderboard|spin|wallet|transactions|settings)(\/|$)/;

/**
 * Edge middleware handles two concerns:
 *
 * 1. **Hostname routing** — keeps canquest.cc (marketing) and app.canquest.cc
 *    (dapp) cleanly separated without needing two separate deployments.
 *
 * 2. **Auth guard** — cookie *presence* check on protected app routes.
 *    Full JWT verification happens in the (app) layout server component.
 */
export function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  // ── 1. Hostname routing (production only; skip on localhost) ──────────────
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    const isMarketingHost =
      hostname === MARKETING_HOST || hostname === `www.${MARKETING_HOST}`;
    const isAppHost = hostname === APP_HOST;

    if (isMarketingHost && APP_ROUTE_PATTERN.test(pathname)) {
      // Someone hit canquest.cc/dashboard etc. → push them to the dapp subdomain
      const appUrl = new URL(request.url);
      appUrl.hostname = APP_HOST;
      return NextResponse.redirect(appUrl, { status: 308 });
    }

    if (isAppHost && pathname === '/') {
      // app.canquest.cc/ → go to dashboard (or login if not authed)
      const token = request.cookies.get(CQ_ACCESS_COOKIE)?.value;
      const dest = token ? '/dashboard' : '/login';
      return NextResponse.redirect(new URL(dest, request.url));
    }
  }

  // ── 2. Auth guard on protected routes ────────────────────────────────────
  if (!PROTECTED_PATTERN.test(pathname)) return NextResponse.next();

  const token = request.cookies.get(CQ_ACCESS_COOKIE)?.value;
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Root — needed for the app.canquest.cc/ redirect
    '/',
    // Auth routes — needed for the hostname cross-redirect
    '/login',
    '/login/:path*',
    '/register',
    '/register/:path*',
    '/verify-otp',
    '/verify-otp/:path*',
    // Protected app routes
    '/dashboard',
    '/dashboard/:path*',
    '/quests',
    '/quests/:path*',
    '/leaderboard',
    '/leaderboard/:path*',
    '/spin',
    '/spin/:path*',
    '/wallet',
    '/wallet/:path*',
    '/transactions',
    '/transactions/:path*',
    '/settings',
    '/settings/:path*',
  ],
};
