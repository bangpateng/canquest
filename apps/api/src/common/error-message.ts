/**
 * error-message — ambil pesan yang bisa dibaca dari nilai yang dilempar.
 *
 * `catch (e)` bertipe `unknown`. Pola `String(e?.message ?? e)` memicu
 * `no-base-to-string` (objek bisa ikut ter-stringify jadi "[object Object]"),
 * sedangkan `String(e)` telanjang juga sama. Helper ini melakukan narrowing
 * eksplisit dengan urutan yang paling informatif:
 *
 *   1. Error            → `.message` (kasus dominan: BadRequestException dll)
 *   2. string           → apa adanya
 *   3. number/boolean   → stringifikasi aman
 *   4. objek ber-`message` string → `.message`
 *   5. objek lain       → JSON (lebih berguna daripada "[object Object]")
 *   6. sisanya          → ''
 *
 * PURE: tanpa DB/state/jaringan.
 */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value !== null && typeof value === 'object') {
    const msg = (value as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
    try {
      const json = JSON.stringify(value);
      if (json && json !== '{}') return json;
    } catch {
      /* nilai sirkular / tak bisa di-JSON-kan */
    }
  }
  return '';
}
