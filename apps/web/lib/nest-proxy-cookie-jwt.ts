import { type NextRequest, NextResponse } from 'next/server';

import { CQ_ACCESS_COOKIE } from '@/lib/auth-cookies';
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

/** Forward to Nest `/api/**` using `cq_access` as Bearer JWT (Route Handlers only). */
export async function nestWithAccessCookie(req: NextRequest, pathSuffix: string, init: RequestInit): Promise<NextResponse> {
  const token = req.cookies.get(CQ_ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const url = `${internalApiBase()}${pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const upstream = await fetch(url, { ...init, headers, cache: 'no-store' });
  return upstreamToNext(upstream);
}
