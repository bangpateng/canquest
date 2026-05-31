import { okWithSessionCookiesOr502 } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  let body: { userId?: string; code?: string };
  try {
    body = (await req.json()) as { userId?: string; code?: string };
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>('/auth/verify-otp', body);

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return okWithSessionCookiesOr502(data);
}
