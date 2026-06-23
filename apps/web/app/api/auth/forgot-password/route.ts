import { postJsonParse } from '@/lib/api/internal-api-url';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/api/turnstile';
import { NextResponse } from 'next/server';

/**
 * Forgot-password BFF — verifies Turnstile, then forwards to Nest.
 * Nest always replies generically (anti-enumeration); we pass it through unchanged.
 */
export async function POST(req: Request) {
  let body: { email?: string; turnstileToken?: string };
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
  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/forgot-password',
    nestBody,
  );
  // Always forward as-is; Nest response is intentionally generic.
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
