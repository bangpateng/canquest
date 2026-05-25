import { okWithSessionCookiesOr502 } from '@/lib/auth-cookies';
import { postJsonParse } from '@/lib/internal-api-url';
import { NextResponse } from 'next/server';

/** Email + password — no Turnstile, no OTP. */
export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>('/auth/login', body);

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return okWithSessionCookiesOr502(data);
}
