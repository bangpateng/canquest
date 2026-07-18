import { type NextRequest, NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { setXOAuthTempCookie } from '@/lib/auth/auth-cookies';

export const dynamic = 'force-dynamic';

/**
 * Callback handler untuk OAuth Twitter (PKCE flow).
 *
 * Supabase redirect ke sini setelah user authorize di Twitter, dengan query:
 *   ?code=...  (PKCE authorization code)
 *
 * Flow:
 * 1. Tukar code → session via supabase.auth.exchangeCodeForSession().
 * 2. Ambil access_token dari session baru.
 * 3. Simpan ke cookie sementara cq_x_oauth_temp (httpOnly, 5 menit).
 * 4. Redirect ke /settings?twitter_oauth=pending → panel auto-POST ke connect.
 *
 * Note: PKCE code_verifier di-supabase-js v2 disimpan di storage browser. Kalau
 * callback ini jalan server-side tanpa akses ke storage tsb, exchange akan gagal.
 * Solusinya: panel settings (client) yang trigger flow, dan panel itu juga yang
 * handle return via supabase.auth.getSession(). Route ini sebagai fallback robust.
 *
 * Jika exchange gagal di server, panel settings tetap bisa recover via getSession()
 * di client (browser storage masih punya session Supabase).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  if (errorParam) {
    return redirectToSettings(
      `oauth_error=${encodeURIComponent(errorParam)}&error_desc=${encodeURIComponent(errorDesc ?? '')}`,
    );
  }

  if (!code) {
    return redirectToSettings('oauth_error=missing_code');
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return redirectToSettings('oauth_error=server_not_configured');
  }

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      url.toString(),
    );
    if (error || !data.session?.access_token) {
      return redirectToSettings(
        `oauth_error=${encodeURIComponent(error?.message ?? 'no_session')}`,
      );
    }
    const response = redirectToSettings('twitter_oauth=pending');
    setXOAuthTempCookie(response, data.session.access_token);
    return response;
  } catch (err) {
    return redirectToSettings(
      `oauth_error=${encodeURIComponent((err as Error).message || 'unknown')}`,
    );
  }
}

function redirectToSettings(suffix: string): NextResponse {
  const target = new URL('/settings', process.env.NEXT_PUBLIC_WEB_ORIGIN || '');
  target.search = suffix;
  return NextResponse.redirect(target.toString());
}
