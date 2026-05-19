import { type NextRequest, NextResponse } from 'next/server';

import {
  clearAdminAccessCookie,
  setAdminAccessCookie,
} from '@/lib/auth-cookies';
import { internalApiBase } from '@/lib/internal-api-url';

export async function POST(req: NextRequest) {
  const body = await req.text();

  try {
    const res = await fetch(`${internalApiBase()}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { message: text || res.statusText };
    }

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    const token = data.accessToken;
    if (typeof token !== 'string') {
      return NextResponse.json(
        { message: 'Invalid response from authentication server.' },
        { status: 502 },
      );
    }

    const out = NextResponse.json({ ok: true });
    setAdminAccessCookie(out, token);
    return out;
  } catch {
    return NextResponse.json(
      {
        message:
          'Could not reach authentication server. Is the Nest API running?',
      },
      { status: 502 },
    );
  }
}
