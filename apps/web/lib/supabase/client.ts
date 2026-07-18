import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Singleton browser client untuk Supabase Auth (khusus OAuth Twitter).
 *
 * Penting: client ini HANYA dipakai untuk trigger `signInWithOAuth({ provider: 'twitter' })`.
 * Login/register email+password utama TIDAK pakai Supabase — tetap pakai flow
 * BFF (cq_access cookie → NestJS JWT) yang sudah ada.
 *
 * Returns null kalau env NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 * belum di-set. Caller harus handle null (UI panel tampil "not configured").
 */
let browserClient: SupabaseClient | null = null;
let browserClientConfigured = false;

export function getBrowserSupabase(): SupabaseClient | null {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    if (!browserClientConfigured) {
      browserClientConfigured = true;
      // Log sekali saja supaya tidak spam.
      if (typeof console !== 'undefined') {
        console.warn(
          '[supabase] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set. Twitter OAuth disabled.',
        );
      }
    }
    return null;
  }

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: false, // kita gak pakai session Supabase utama
      autoRefreshToken: false,
    },
  });
  return browserClient;
}

/** True kalau env Supabase client sudah dikonfigurasi (untuk gating UI). */
export function isSupabaseOAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}
