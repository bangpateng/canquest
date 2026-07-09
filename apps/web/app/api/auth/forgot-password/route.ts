import { postJsonParse } from '@/lib/api/internal-api-url';
import { clientIpFromRequest, verifyTurnstileToken } from '@/lib/api/turnstile';
import { isSupabaseAuthEnabled } from '@/lib/supabase/config';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * Forgot-password BFF.
 *
 * Mode Supabase: supabase.auth.resetPasswordForEmail() mengirim email reset
 * bawaan Supabase (anti-enumerasi: Supabase tetap balas generic kalau email
 * tidak ada). Redirect URL di-set di dashboard Supabase Auth config.
 * Mode legacy: forward ke Nest /auth/forgot-password (anti-enumerasi generic).
 *
 * Selalu verifikasi Turnstile dulu (anti-bot) di kedua mode.
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

  const email = body.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ message: 'Email required' }, { status: 400 });
  }

  if (isSupabaseAuthEnabled()) {
    const supabase = await getSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_WEB_ORIGIN ?? ''}/reset-password`,
    });
    // Selalu balas generic (anti-enumerasi), terlepas apakah email ada.
    return NextResponse.json({ ok: true });
  }

  const { res, data } = await postJsonParse<Record<string, unknown>>(
    '/auth/forgot-password',
    { email },
  );
  // Always forward as-is; Nest response is intentionally generic.
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
