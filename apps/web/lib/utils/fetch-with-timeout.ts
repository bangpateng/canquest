/**
 * fetch + timeout otomatis (default 15 detik).
 *
 * Tanpa ini, request yang hang (API sempat unreachable / jaringan putus di
 * tengah) bikin `loading` di pemanggil nggak pernah reset — tombol Refresh
 * muter selamanya dan spinner page-load nggak ilang². Timeout memicu
 * AbortError, jadi blok catch pemanggil memperlakukannya sama seperti network
 * error biasa: pesan error tampil, UI kembali normal.
 *
 * Dipakai halaman-halaman admin yang fetch polos ke BFF (earn, partners,
 * ecosystem settings) supaya review nggak pernah melihat state nyangkut.
 */
export async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
