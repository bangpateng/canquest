import { type NextRequest, NextResponse } from 'next/server';

import { CQ_ADMIN_ACCESS_COOKIE } from '@/lib/auth-cookies';
import { internalApiBase } from '@/lib/internal-api-url';

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

/** Forward to Nest `/api/admin/**` using `cq_admin_access` as Bearer JWT. */
export async function nestWithAdminAccessCookie(
  req: NextRequest,
  pathSuffix: string,
  init: RequestInit,
): Promise<NextResponse> {
  const token = req.cookies.get(CQ_ADMIN_ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const url = `${internalApiBase()}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  try {
    const upstream = await fetch(url, { ...init, headers, cache: 'no-store' });
    return upstreamToNext(upstream);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'API unreachable';
    return NextResponse.json({ message: `Gateway error: ${message}` }, { status: 502 });
  }
}
