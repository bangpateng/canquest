import { type NextRequest, NextResponse } from 'next/server';

import {
  CQ_ACCESS_COOKIE,
  CQ_REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from '@/lib/auth/auth-cookies';
import { internalApiBase } from '@/lib/api/internal-api-url';

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
 * Ambil access token dari cq_access cookie untuk dikirim sebagai Bearer ke Nest.
 * Nest JwtStrategy (HS256) memverifikasi token ini.
 */
async function extractAccessToken(req: NextRequest): Promise<string | null> {
  return req.cookies.get(CQ_ACCESS_COOKIE)?.value ?? null;
}

/** Forward to Nest `/api/**` using cq_access cookie as Bearer JWT (Route Handlers only). */
export async function nestWithAccessCookie(
  req: NextRequest,
  pathSuffix: string,
  init: RequestInit,
  options?: NestProxyOptions,
): Promise<NextResponse> {
  const token = await extractAccessToken(req);
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

  const fetchUpstream = (bearer: string): Promise<Response> => {
    const upstreamHeaders = new Headers(headers);
    upstreamHeaders.set('Authorization', `Bearer ${bearer}`);
    return fetch(url, {
      ...init,
      headers: upstreamHeaders,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  };

  try {
    let upstream = await fetchUpstream(token);

    // Access token expired (15 menit) → tukar cq_refresh ke Nest sekali, retry 1x.
    // Hanya refresh-token rejection yang mengakhiri sesi. Kegagalan upstream
    // sementara tetap diteruskan sebagai 502/504 agar user tidak dipaksa login ulang.
    if (upstream.status === 401) {
      const refreshToken = req.cookies.get(CQ_REFRESH_COOKIE)?.value;
      // Body stream tidak bisa dikirim ulang; BFF routes selalu pass string body.
      const bodyRetriable =
        init.body === undefined ||
        typeof init.body === 'string' ||
        init.body instanceof ArrayBuffer;

      if (!refreshToken) {
        const out = sessionExpiredResponse();
        clearAuthCookies(out);
        return out;
      }

      if (bodyRetriable) {
        const refreshResult = await refreshSingleFlight(refreshToken);
        if (refreshResult.kind === 'success') {
          upstream = await fetchUpstream(refreshResult.tokens.accessToken);
          const out = await upstreamToNext(upstream);
          // Rotasi cookie sesi (access 15m + refresh 30d) untuk request berikutnya.
          setAuthCookies(
            out,
            refreshResult.tokens.accessToken,
            refreshResult.tokens.refreshToken,
          );
          return out;
        }

        if (refreshResult.kind === 'rejected') {
          const out = sessionExpiredResponse();
          clearAuthCookies(out);
          return out;
        }

        return NextResponse.json(
          { ok: false, message: 'Authentication service temporarily unavailable' },
          { status: 502 },
        );
      }
    }

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

type RefreshedTokens = { accessToken: string; refreshToken: string };

type RefreshResult =
  | { kind: 'success'; tokens: RefreshedTokens }
  | { kind: 'rejected' }
  | { kind: 'temporary-failure' };

function sessionExpiredResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, code: 'SESSION_EXPIRED', message: 'Session expired' },
    { status: 401 },
  );
}

/** Single-flight: banyak 401 paralel → satu round-trip refresh saja. */
let inflightRefresh: Promise<RefreshResult> | null = null;

function refreshSingleFlight(refreshToken: string): Promise<RefreshResult> {
  if (!inflightRefresh) {
    inflightRefresh = refreshSession(refreshToken).finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

async function refreshSession(refreshToken: string): Promise<RefreshResult> {
  try {
    const res = await fetch(`${internalApiBase()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401 || res.status === 403) {
      return { kind: 'rejected' };
    }
    if (!res.ok) {
      return { kind: 'temporary-failure' };
    }

    const data = (await res.json().catch(() => null)) as {
      accessToken?: unknown;
      refreshToken?: unknown;
    } | null;
    if (
      data &&
      typeof data.accessToken === 'string' &&
      typeof data.refreshToken === 'string'
    ) {
      return {
        kind: 'success',
        tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken },
      };
    }

    return { kind: 'temporary-failure' };
  } catch {
    return { kind: 'temporary-failure' };
  }
}
