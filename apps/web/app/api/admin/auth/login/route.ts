import { type NextRequest, NextResponse } from 'next/server';

import { setAdminAccessCookie } from '@/lib/auth/auth-cookies';
import { internalApiBase } from '@/lib/api/internal-api-url';
import {
  clientIpFromRequest,
  verifyTurnstileToken,
} from '@/lib/api/turnstile';

/**
 * Admin login — verifikasi Turnstile di BFF, lalu forward email + password +
 * kode TOTP ke Nest /admin/auth/login beserta header shared secret
 * (x-admin-bff-secret) yang disyaratkan nginx VPS untuk /api/admin/*.
 */
export async function POST(req: NextRequest) {
  let body: {
    email?: string;
    password?: string;
    totpCode?: string;
    turnstileToken?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const captcha = await verifyTurnstileToken(
    body.turnstileToken,
    clientIpFromRequest(req),
  );
  if (!captcha.ok) return captcha.response;

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) {
    return NextResponse.json(
      { message: 'Email and password required' },
      { status: 400 },
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const adminBffSecret = process.env.ADMIN_BFF_SECRET?.trim();
  if (adminBffSecret) headers['x-admin-bff-secret'] = adminBffSecret;

  try {
    const res = await fetch(`${internalApiBase()}/admin/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        password,
        ...(body.totpCode ? { totpCode: body.totpCode } : {}),
      }),
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
