import { type NextRequest, NextResponse } from 'next/server';

import { CQ_ACCESS_COOKIE } from '@/lib/auth/auth-cookies';
import { internalApiBase } from '@/lib/api/internal-api-url';
import { getSupabaseConfig } from '@/lib/supabase/config';

async function upstreamToNext(upstream: Response): Promise<NextResponse> {
  const text = await upstream.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text || upstream.statusText };
  }
  return NextResponse.json(data, { status: upstream.status });
}

export type NestProxyOptions = {
  /** Max wait for Nest upstream (default 15s). Canton ledger submits need longer. */
  upstreamTimeoutMs?: number;
};

/**
 * Ambil access token dari request untuk dikirim sebagai Bearer ke Nest.
 *
 * Urutan prioritas:
 *  1. Supabase access token dari cookie `sb-*-access-token` (mode Supabase).
 *  2. Legacy `cq_access` cookie (mode HS256 / rollback / user belum re-login).
 *
 * Token Supabase diverifikasi JwtStrategy di Nest (mode SUPABASE_AUTH_ENABLED=true);
 * token legacy diverifikasi JwtStrategy HS256 (mode false). Nest dispatch berdasarkan
 * flag-nya sendiri, jadi kedua token bisa hidup berdampingan selama transisi.
 */
function extractAccessToken(req: NextRequest): string | null {
  const config = getSupabaseConfig();
  if (config) {
    const supabaseCookie = req.cookies
      .getAll()
      .find((c) => c.name.startsWith('sb-') && c.name.includes('access-token'));
    if (supabaseCookie?.value) return supabaseCookie.value;
  }
  // Fallback legacy (selama transisi / mode rollback).
  return req.cookies.get(CQ_ACCESS_COOKIE)?.value ?? null;
}

/** Forward to Nest `/api/**` using Supabase/legacy access token as Bearer JWT (Route Handlers only). */
export async function nestWithAccessCookie(
  req: NextRequest,
  pathSuffix: string,
  init: RequestInit,
  options?: NestProxyOptions,
): Promise<NextResponse> {
  const token = extractAccessToken(req);
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const url = `${internalApiBase()}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  // So Nest rate-limits per browser user, not per Vercel/server egress IP.
  const forwarded =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim();
  if (forwarded) {
    headers.set('X-Forwarded-For', forwarded);
  }

  const timeoutMs = options?.upstreamTimeoutMs ?? 15_000;

  try {
    const upstream = await fetch(url, {
      ...init,
      headers,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
    return upstreamToNext(upstream);
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout/i.test(err.message));
    if (isTimeout) {
      return NextResponse.json(
        {
          ok: false,
          message:
            'Request timed out while waiting for Canton. If you submitted a quest, wait a few seconds and try again.',
        },
        { status: 504 },
      );
    }
    // Non-timeout errors (network, DNS, etc.) → return JSON 502 instead of
    // letting the error propagate and produce an HTML 500 page.
    return NextResponse.json(
      { ok: false, message: 'Upstream API unavailable' },
      { status: 502 },
    );
  }
}
