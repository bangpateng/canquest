import { postJsonParse } from '@/lib/api/internal-api-url';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/api/turnstile';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_MESSAGE = 4000;

/** Public Cooperation form → Nest POST /api/public/contact. Turnstile-checked here. */
export async function POST(req: Request) {
  let body: {
    name?: string;
    email?: string;
    organization?: string;
    collaborationType?: string;
    budget?: string;
    message?: string;
    turnstileToken?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  // Basic server-side guard before reaching Nest (which also validates the DTO).
  const name = body.name?.trim() ?? '';
  const email = body.email?.trim() ?? '';
  const message = body.message?.trim() ?? '';
  if (!name || !email || !message) {
    return NextResponse.json(
      { message: 'Name, email, and message are required.' },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { message: 'Message is too long.' },
      { status: 400 },
    );
  }

  const captcha = await verifyTurnstileToken(
    body.turnstileToken,
    clientIpFromRequest(req),
  );
  if (!captcha.ok) return captcha.response;

  const { turnstileToken: _t, ...nestBody } = body;
  const { res, data } = await postJsonParse<{ ok?: boolean; message?: string }>(
    '/public/contact',
    nestBody,
  );

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json(data);
}
