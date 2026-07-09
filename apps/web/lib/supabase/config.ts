/**
 * Konfigurasi Supabase yang dipakai browser & server client.
 *
 * NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY diekspos ke browser
 * (anon key aman untuk client — RLS tetap aktif untuk koneksi anon).
 * service_role key TIDAK pernah ada di frontend.
 */
export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Jangan throw di sini (akan break SSR build kalau env belum diset saat dev).
    // Komponen yang pakai Supabase harus cek ketersediaan sebelum memanggil.
    return null;
  }
  return { url, anonKey };
}

/** True jika Supabase Auth aktif (env lengkap). Dipakai UI untuk gating login path. */
export function isSupabaseAuthEnabled(): boolean {
  return getSupabaseConfig() !== null;
}
