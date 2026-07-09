import { postJsonParse } from '@/lib/api/internal-api-url';
import { isSupabaseAuthEnabled } from '@/lib/supabase/config';
import { NextResponse } from 'next/server';

/**
 * Reset-password BFF.
 *
 * Mode Supabase: reset password di-handle Supabase native via halaman redirect
 * (user klik link email → Supabase set session recovery → frontend update user).
 * Endpoint ini menjadi fallback legacy. Untuk kompatibilitas, di mode Supabase
 * return instruksi.
 * Mode legacy: forward { email, code, newPassword } ke Nest. Tidak set session
 * cookie — reset TIDAK auto-login.
 */
export async function POST(req: Request) {
  let body: { email?: string; code?: string; newPassword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  if (isSupabaseAuthEnabled()) {
    return NextResponse.json(
      {
        message:
          'Password reset is handled by Supabase via the email link. Use supabase.auth.updateUser({ password }) on the recovery page.',
      },
      { status: 410 }, // Gone
    );
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/reset-password',
    body,
  );
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
