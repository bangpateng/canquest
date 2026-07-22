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

// ── Maintenance mode (server-side rewrite to /maintenance) ───────────────────
// Cache modul-level TTL 5 detik supaya fetch tidak dibombard tiap request.
let maintenanceCache: { on: boolean; expiresAt: number } | null = null;
const MAINTENANCE_TTL_MS = 5_000;

async function isMaintenanceOn(request: NextRequest): Promise<boolean> {
  const now = Date.now();
  if (maintenanceCache && maintenanceCache.expiresAt > now) {
    return maintenanceCache.on;
  }
  let on = false;
  try {
    // Origin sendiri — route /api/* di-exclude dari matcher jadi tidak rekursif.
    const res = await fetch(
      new URL('/api/public/maintenance', request.nextUrl.origin),
      { cache: 'no-store' },
    );
    if (res.ok) {
      const data = (await res.json()) as { enabled?: boolean };
      on = Boolean(data.enabled);
    }
  } catch {
    on = false; // fail-open
  }
  maintenanceCache = { on, expiresAt: now + MAINTENANCE_TTL_MS };
  return on;
}

/** True bila user memiliki session aktif (cq_access cookie). */
function hasSession(request: NextRequest): boolean {
  return request.cookies.has(CQ_ACCESS_COOKIE);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Defense-in-depth: jangan pernah kunci area yang butuh untuk recovery ──
  // /admin (admin panel), /api (BFF/proxy), /maintenance (anti-loop), dan path
  // statis (mengandung titik) TIDAK boleh ter-rewrite. Matcher di config sudah
  // exclude, tapi pengecekan eksplisit di sini menjamin keamanan di semua versi.
  if (
    pathname === '/maintenance' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api') ||
    /\.[^/]+$/.test(pathname) // file statis (favicon.ico, robots.txt, dll.)
  ) {
    return NextResponse.next();
  }

  // ── Maintenance gate (paling awal) ──────────────────────────────────────
  // Saat ON, SEMUA path non-admin/non-api di-rewrite ke /maintenance.
  if (await isMaintenanceOn(request)) {
    return NextResponse.rewrite(new URL('/maintenance', request.url));
  }

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
  if (!PROTECTED_PATTERN.test(pathname)) {
    return NextResponse.next();
  }
  if (PUBLIC_EARN_DETAIL_PATTERN.test(pathname)) {
    return NextResponse.next();
  }

  // Cek session: cq_access cookie.
  if (!hasSession(request)) {
    const home = new URL('/', request.url);
    home.searchParams.set('auth', 'login');
    if (pathname !== '/') home.searchParams.set('next', pathname);
    return NextResponse.redirect(home);
  }

  return NextResponse.next();
}

export const config = {
  // Match hampir semua path, KECUALI: /api/* (BFF/proxy), /admin/* (recovery),
  // /_next/* (static), /maintenance (anti-loop), dan path mengandung titik
  // (file statis seperti favicon.ico, robot.txt, gambar).
  matcher: [
    '/((?!api|admin|_next|maintenance|.*\\..*).*)',
  ],
};
