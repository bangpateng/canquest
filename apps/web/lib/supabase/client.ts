import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseConfig } from './config';

/**
 * Browser-side Supabase client (singleton).
 *
 * Dipakai untuk auth actions dari client component: signInWithPassword,
 * signOut, resetPasswordForEmail, onAuthStateChange, dll.
 *
 * Cookie `sb-*-access-token` / `sb-*-refresh-token` di-manage otomatis oleh
 * @supabase/ssr → httpOnly, sameSite=lax, secure di production.
 */
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error(
      'Supabase belum dikonfigurasi — set NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  if (!browserClient) {
    browserClient = createBrowserClient(config.url, config.anonKey);
  }
  return browserClient;
}
