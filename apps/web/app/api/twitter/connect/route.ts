import { type NextRequest, NextResponse } from 'next/server';
import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/turnstile';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { username?: string; turnstileToken?: string };
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

  const { turnstileToken: _t, username } = body;
  return nestWithAccessCookie(req, '/twitter/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
}
