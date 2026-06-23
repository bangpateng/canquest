import { postJsonParse } from '@/lib/api/internal-api-url';
import { NextResponse } from 'next/server';

/**
 * Reset-password BFF — forwards { email, code, newPassword } to Nest.
 * No session cookies are set here: reset does NOT auto-login.
 */
export async function POST(req: Request) {
  let body: { email?: string; code?: string; newPassword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/reset-password',
    body,
  );
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
