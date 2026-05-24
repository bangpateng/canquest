import { type NextRequest, NextResponse } from 'next/server';

import { CQ_ACCESS_COOKIE } from '@/lib/auth-cookies';

/** Routes that require session cookie (JWT verified in platform layout). */
const PROTECTED_PATTERN =
  /^\/(overview|quest|earn|spin-reward|spin-daily|wallet|leaderboard|setting)(\/|$)/;

/** Legacy app paths → new platform paths */
const LEGACY_REDIRECTS: Record<string, string> = {
  '/dashboard': '/overview',
  '/quests': '/earn',
  '/spin': '/spin-reward',
  '/spin-daily': '/spin-reward',
  '/settings': '/setting',
  '/transactions': '/wallet',
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Legacy path redirects (same host — canquest.cc only)
  if (LEGACY_REDIRECTS[pathname]) {
    return NextResponse.redirect(new URL(LEGACY_REDIRECTS[pathname], request.url), 308);
  }
  if (pathname.startsWith('/quests/')) {
    const dest = pathname.replace(/^\/quests\//, '/earn/');
    return NextResponse.redirect(new URL(dest, request.url), 308);
  }
  // Campaign detail was briefly at /quest/:id → /earn/:id (/quest alone = Earn hub)
  if (pathname.startsWith('/quest/') && pathname.length > 7) {
    const dest = pathname.replace(/^\/quest\//, '/earn/');
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
    '/overview',
    '/overview/:path*',
    '/quest',
    '/quest/:path*',
    '/earn',
    '/earn/:path*',
    '/spin-daily',
    '/spin-daily/:path*',
    '/spin-reward',
    '/spin-reward/:path*',
    '/setting',
    '/setting/:path*',
  ],
};
