import { NextResponse } from 'next/server';

import { clearAuthCookies } from '@/lib/auth/auth-cookies';
import { isSupabaseAuthEnabled } from '@/lib/supabase/config';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Logout: revoke session di Supabase (kalau aktif) + clear semua auth cookie.
 * Selalu bersihkan cookie legacy cq_* juga (selama transisi / rollback).
 */
export async function POST() {
  const out = NextResponse.json({ ok: true });

  if (isSupabaseAuthEnabled()) {
    try {
      const supabase = await getSupabaseServerClient();
      await supabase.auth.signOut();
    } catch {
      // signOut gagal (mis. session sudah expired) → tetap clear cookie di bawah.
    }
  }

  clearAuthCookies(out);
  return out;
}
