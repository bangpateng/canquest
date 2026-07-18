import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client untuk dipakai di Next.js Route Handlers (BFF).
 * Dipakai oleh /api/twitter/oauth/callback untuk exchange code → session
 * saat menerima redirect balik dari Supabase/Twitter OAuth (PKCE flow).
 *
 * Karena Supabase-js v2 butuh Node 20+ untuk realtime (WebSocket native), dan
 * VPS / Vercel sudah Node 20, ini aman. PersistSession false karena kita
 * gak simpan session Supabase — kita cuma butuh one-shot exchange di callback.
 */
let serverClient: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient | null {
  if (serverClient) return serverClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  serverClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serverClient;
}
