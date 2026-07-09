import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseConfig } from './config';

/** Bentuk cookie yang di-set oleh @supabase/ssr (lihat SetAllCookies di lib types). */
type SupabaseCookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

/**
 * Refresh Supabase session di Edge Middleware.
 *
 * Dipanggil di middleware.ts untuk:
 *  1. Memperpanjang access token yang hampir expired (auto-refresh pakai refresh
 *     token dari cookie sb-*-refresh-token).
 *  2. Menulis session yang sudah di-refresh balik ke response cookie.
 *
 * Return { supabase, response, user }:
 *  - user null = tidak ada session (guest).
 *  - response = NextResponse yang HARUS di-return supaya cookie ke-set.
 *
 * Fallback: kalau env Supabase belum diset (mode legacy/rollback), return null
 * supaya middleware pakai cookie cq_access lama.
 */
export async function updateSession(
  request: NextRequest,
): Promise<
  | null
  | {
      user: { id: string } | null;
      response: NextResponse;
    }
> {
  const config = getSupabaseConfig();
  if (!config) return null;

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: SupabaseCookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options ?? {}),
        );
      },
    },
  });

  // getUser() memaksa refresh kalau access token expired.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, response };
}
