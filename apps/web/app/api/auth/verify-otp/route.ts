import { setAuthCookies } from '@/lib/auth/auth-cookies';
import { postJsonParse } from '@/lib/api/internal-api-url';
import { isSupabaseAuthEnabled } from '@/lib/supabase/config';
import { NextResponse } from 'next/server';

/**
 * Verify OTP (email confirmation code).
 *
 * Mode Supabase: OTP diverifikasi langsung via Supabase native (frontend memakai
 * supabase.auth.verifyOtp({ type:'email', token, email })). Endpoint ini menjadi
 * fallback legacy. Untuk kompatibilitas, di mode Supabase kita return instruksi
 * kalau caller masih hit route lama.
 * Mode legacy: forward ke Nest /auth/verify-otp, set cookie cq_*.
 */
export async function POST(req: Request) {
  let body: { userId?: string; code?: string };
  try {
    body = (await req.json()) as { userId?: string; code?: string };
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  if (isSupabaseAuthEnabled()) {
    return NextResponse.json(
      {
        message:
          'OTP verification is handled by Supabase. Use supabase.auth.verifyOtp() from the client.',
      },
      { status: 410 }, // Gone — endpoint ini deprecated di mode Supabase
    );
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/verify-otp',
    body,
  );

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const out = NextResponse.json({ ok: true });
  if (
    typeof data.accessToken === 'string' &&
    typeof data.refreshToken === 'string'
  ) {
    setAuthCookies(out, data.accessToken, data.refreshToken);
  }
  return out;
}
