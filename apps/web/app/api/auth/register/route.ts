import { okWithSessionCookiesOr502 } from '@/lib/auth-cookies';
import { postJsonParse } from '@/lib/internal-api-url';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  let body: {
    displayName?: string;
    email?: string;
    password?: string;
    inviteCode?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>('/auth/register', body);

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  if (typeof data.accessToken === 'string' && typeof data.refreshToken === 'string') {
    return okWithSessionCookiesOr502(data);
  }

  return NextResponse.json(data);
}
