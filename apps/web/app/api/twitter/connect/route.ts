import { type NextRequest, NextResponse } from 'next/server';
import {
  nestWithAccessCookie,
} from '@/lib/auth/nest-proxy-cookie-jwt';
import {
  readXOAuthTempCookie,
  clearXOAuthTempCookie,
} from '@/lib/auth/auth-cookies';

export const dynamic = 'force-dynamic';

/**
 * Connect X via OAuth — proxy ke NestJS `/twitter/connect`.
 *
 * Body (preferred): { oauthAccessToken: string }
 *   Token diambil dari session Supabase di client component, dikirim eksplisit.
 *
 * Fallback: kalau body gak ada oauthAccessToken, baca dari cookie sementara
 * `cq_x_oauth_temp` (di-set oleh OAuth callback page).
 *
 * Turnstile tidak diperlukan di sini karena OAuth flow itu sendiri sudah
 * merupakan human-proof (user harus login ke Twitter & authorize app manual).
 */
export async function POST(req: NextRequest) {
  let body: { oauthAccessToken?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // body kosong / invalid → fallback ke cookie
  }

  let oauthAccessToken = body.oauthAccessToken?.trim();
  if (!oauthAccessToken) {
    oauthAccessToken = readXOAuthTempCookie(req) ?? undefined;
  }
  if (!oauthAccessToken) {
    return NextResponse.json(
      {
        message:
          'Missing OAuth access token. Please retry Connect X from Settings.',
      },
      { status: 400 },
    );
  }

  const upstream = await nestWithAccessCookie(req, '/twitter/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oauthAccessToken }),
  });

  // Hapus cookie sementara setelah connect selesai (sukses maupun gagal).
  if (!body.oauthAccessToken) {
    clearXOAuthTempCookie(upstream);
  }
  return upstream;
}
