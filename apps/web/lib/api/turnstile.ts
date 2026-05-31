import { NextResponse } from 'next/server';

type TurnstileVerifyResponse = {
  success?: boolean;
  'error-codes'?: string[];
};

/** Server-side Cloudflare Turnstile check (secret never exposed to browser). */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteip?: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        response: NextResponse.json(
          { message: 'Captcha is not configured on the server.' },
          { status: 503 },
        ),
      };
    }
    return { ok: true };
  }

  if (!token?.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: 'Complete the captcha before continuing.' },
        { status: 400 },
      ),
    };
  }

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
  });
  if (remoteip) body.set('remoteip', remoteip);

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await res.json().catch(() => ({}))) as TurnstileVerifyResponse;
  if (!data.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { message: 'Captcha verification failed. Try again.' },
        { status: 403 },
      ),
    };
  }

  return { ok: true };
}

export function clientIpFromRequest(req: Request): string | undefined {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim();
  return req.headers.get('x-real-ip') ?? undefined;
}
