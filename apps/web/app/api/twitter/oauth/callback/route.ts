import { type NextRequest, NextResponse } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/**
 * Callback handler OAuth Twitter (PKCE flow manual — bukan Supabase).
 *
 * Twitter redirect ke sini setelah user authorize, dengan query:
 *   ?code=...&state=...
 *
 * Flow:
 *   1. Validasi code + state ada.
 *   2. Forward ke NestJS GET /twitter/callback?code=...&state=...
 *      Backend akan:
 *        - Consume state dari Redis (verifikasi + ambil codeVerifier).
 *        - Exchange code + codeVerifier → access_token.
 *        - GET /2/users/me → profil X terverifikasi.
 *        - Persist ke DB (anti-sybil, permanent lock, anti-bot umur akun).
 *   3. Redirect ke /settings?twitter_oauth=success kalau sukses.
 *   4. Redirect ke /settings?twitter_oauth=error&... kalau gagal.
 *
 * Catatan: user HARUS punya sesi cq_access valid saat callback (state Redis
 * terikat ke userId dari sesi). Kalau sesi expired → backend akan tolak
 * dengan "OAuth session mismatch".
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  // Twitter/aneh error → balik ke settings dengan error flag.
  if (errorParam) {
    return redirectToSettings(
      `twitter_oauth=error&error=${encodeURIComponent(errorParam)}` +
        (errorDesc ? `&error_desc=${encodeURIComponent(errorDesc)}` : ''),
    );
  }
  if (!code || !state) {
    return redirectToSettings('twitter_oauth=error&error=missing_code_or_state');
  }

  // Forward ke backend NestJS dengan access cookie sebagai Bearer.
  const callbackPath = `/twitter/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
  const upstream = await nestWithAccessCookie(req, callbackPath, {
    method: 'GET',
  });

  // Baca body response untuk ambil username (untuk toast sukses frontend).
  let upstreamBody: { ok?: boolean; username?: string; message?: string } = {};
  try {
    upstreamBody = await upstream.json();
  } catch {
    upstreamBody = {};
  }

  if (upstream.status >= 200 && upstream.status < 300 && upstreamBody.ok) {
    return redirectToSettings(
      `twitter_oauth=success&username=${encodeURIComponent(upstreamBody.username ?? '')}`,
    );
  }

  // Gagal — pesan error ke frontend.
  const msg = upstreamBody.message || 'callback_failed';
  return redirectToSettings(
    `twitter_oauth=error&error=${encodeURIComponent(msg)}`,
  );
}

function redirectToSettings(suffix: string): NextResponse {
  const target = new URL(
    '/settings',
    process.env.NEXT_PUBLIC_WEB_ORIGIN || 'http://localhost:3000',
  );
  target.search = suffix;
  target.hash = 'twitter';
  return NextResponse.redirect(target.toString());
}
