import { type NextRequest, NextResponse } from 'next/server';

import { CQ_ACCESS_COOKIE } from '@/lib/auth/auth-cookies';

/** Routes that require session cookie (JWT verified in platform layout). */
const PROTECTED_PATTERN =
  /^\/(overview|quests|earn|wallet|leaderboard|settings)(\/|$)/;

const PUBLIC_EARN_DETAIL_PATTERN = /^\/earn\/[^/]+\/?$/;

/** Legacy app paths → new platform paths */
const LEGACY_REDIRECTS: Record<string, string> = {
  '/quest': '/quests',
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legacy path redirects (same host — canquest.cc only)
  if (LEGACY_REDIRECTS[pathname]) {
    return NextResponse.redirect(new URL(LEGACY_REDIRECTS[pathname], request.url), 308);
  }
  // Legacy: /quests/:id was briefly campaign detail → /earn/:id
  // Note: /quests alone is now the earn hub, only /quests/:id redirects
  if (pathname.startsWith('/quests/') && pathname.length > 8) {
    const dest = pathname.replace(/^\/quests\//, '/earn/');
    return NextResponse.redirect(new URL(dest, request.url), 308);
  }

  // Auth pages → landing with modal hint
  if (pathname === '/login' || pathname === '/register') {
    const url = new URL('/', request.url);
    url.searchParams.set('auth', pathname === '/register' ? 'register' : 'login');
    const next = request.nextUrl.searchParams.get('next');
    if (next) url.searchParams.set('next', next);
    return NextResponse.redirect(url);
  }

  // Protected platform routes
  if (!PROTECTED_PATTERN.test(pathname)) return NextResponse.next();
  if (PUBLIC_EARN_DETAIL_PATTERN.test(pathname)) return NextResponse.next();

  const token = request.cookies.get(CQ_ACCESS_COOKIE)?.value;
  if (!token) {
    const home = new URL('/', request.url);
    home.searchParams.set('auth', 'login');
    if (pathname !== '/') home.searchParams.set('next', pathname);
    return NextResponse.redirect(home);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/login/:path*',
    '/register',
    '/register/:path*',
    '/quests',
    '/quests/:path*',
    '/leaderboard',
    '/leaderboard/:path*',
    '/wallet',
    '/wallet/:path*',
    '/settings',
    '/settings/:path*',
    '/overview',
    '/overview/:path*',
    '/quest',
    '/quest/:path*',
    '/earn',
    '/earn/:path*',
  ],
};
