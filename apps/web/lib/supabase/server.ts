import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from './config';

/** Bentuk cookie yang di-set oleh @supabase/ssr. */
type SupabaseCookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

/**
 * Server-side Supabase client (Route Handlers + Server Components).
 *
 * Membaca/menulis cookie Supabase dari Next.js cookie store. Dipakai di:
 *  - Server Components untuk getSession() (e.g. landing "Launch App" button)
 *  - BFF route handlers (register, logout) untuk manipulasi session server-side.
 */
export async function getSupabaseServerClient() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      'Supabase belum dikonfigurasi — set NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: SupabaseCookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options ?? {}),
          );
        } catch {
          // Dipanggil dari Server Component (read-only cookie) → aman di-ignore;
          // refresh token akan dihandle di middleware updateSession().
        }
      },
    },
  });
}

/**
 * Ambil access token Supabase untuk proxy ke Nest.
 * Dipakai nest-proxy-cookie-jwt untuk kirim `Authorization: Bearer <jwt>` ke API.
 * Return null kalau tidak ada session.
 */
export async function getSupabaseAccessToken(): Promise<string | null> {
  const config = getSupabaseConfig();
  if (!config) return null;
  const supabase = await getSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
