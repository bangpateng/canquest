type TimedResponse = Response & {
  /** Parse JSON while the same request timeout remains active. */
  json: Response["json"];
};

/**
 * fetch + timeout otomatis (default 15 detik).
 *
 * Tanpa ini, request yang hang (API sempat unreachable / jaringan putus di
 * tengah) bikin `loading` di pemanggil nggak pernah reset — tombol Refresh
 * muter selamanya dan spinner page-load nggak ilang². Timeout memicu
 * AbortError, jadi blok catch pemanggil memperlakukannya sama seperti network
 * error biasa: pesan error tampil, UI kembali normal.
 *
 * Timer tetap aktif sampai body response selesai dibaca. Ini penting karena
 * `fetch()` bisa menerima headers dulu lalu macet di `res.json()`.
 *
 * Dipakai halaman-halaman admin yang fetch polos ke BFF (earn, partners,
 * ecosystem settings) supaya review nggak pernah melihat state nyangkut.
 */
export async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<TimedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      signal: init?.signal ?? controller.signal,
    });

    const clear = () => clearTimeout(timer);
    const originalJson = response.json.bind(response);
    response.json = async (...args: Parameters<Response["json"]>) => {
      try {
        return await originalJson(...args);
      } finally {
        clear();
      }
    };
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}
