import { type NextRequest, NextResponse } from 'next/server';

import { CQ_ACCESS_COOKIE } from '@/lib/auth/auth-cookies';
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

/** Forward to Nest `/api/**` using `cq_access` as Bearer JWT (Route Handlers only). */
export async function nestWithAccessCookie(
  req: NextRequest,
  pathSuffix: string,
  init: RequestInit,
  options?: NestProxyOptions,
): Promise<NextResponse> {
  const token = req.cookies.get(CQ_ACCESS_COOKIE)?.value;
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
    throw err;
  }
}
