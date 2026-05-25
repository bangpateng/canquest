import { okWithSessionCookiesOr502 } from '@/lib/auth-cookies';
import { postJsonParse } from '@/lib/internal-api-url';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/turnstile';
import { NextResponse } from 'next/server';

/** Email + password with Cloudflare Turnstile. */
export async function POST(req: Request) {
  let body: { email?: string; password?: string; turnstileToken?: string };
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

  const { turnstileToken: _t, ...nestBody } = body;
  const { res, data } = await postJsonParse<Record<string, unknown>>('/auth/login', nestBody);

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return okWithSessionCookiesOr502(data);
}
