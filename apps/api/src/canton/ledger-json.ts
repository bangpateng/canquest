/**
 * ledger-json — pembaca SEMPIT untuk JSON Ledger API Canton.
 *
 * MASALAH: respons ledger bertipe bebas (`unknown`). Membaca field-nya langsung
 * memicu `no-unsafe-assignment` / `no-unsafe-member-access`; meng-cast ke `any`
 * hanya memindahkan masalah ke tempat lain (dan menyembunyikan salah tulis).
 *
 * SOLUSI: narrowing eksplisit di satu tempat. Setiap pembaca mengembalikan nilai
 * HANYA bila tipenya benar-benar sesuai — dengan nilai fallback yang sama
 * seperti pembacaan langsung sebelumnya, sehingga perilaku runtime tidak
 * berubah. Modul ini murni: tanpa DB, state, atau jaringan.
 *
 * Bentuk JSON yang ditangani (JSON Ledger API v2):
 *   /v2/state/active-contracts → [ { contractEntry: { JsActiveContract:
 *     { createdEvent: { templateId, contractId, createArgument, ... } } } } ]
 */

/** Objek non-array → Record; nilai lain (termasuk array) → null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** String bila memang string, selain itu null. */
export function readStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** String dengan fallback — pengganti `x ?? ''` pada nilai tak bertipe. */
export function readStrOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Array string; elemen non-string dibuang. Dipakai untuk field yang tipenya
 * dideklarasikan `string[]` supaya data aneh tidak lolos sebagai kebohongan tipe.
 */
export function readStrArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

/**
 * `value != null ? Number(value) : undefined` — semantik lama dipertahankan
 * apa adanya (termasuk NaN bila nilainya bukan angka), karena beberapa field
 * ledger (mis. `round`) memang diperlakukan begitu.
 */
export function readNumOrUndefined(value: unknown): number | undefined {
  return value != null ? Number(value) : undefined;
}

/**
 * Akses berantai aman: `pick(root, 'a', 'b')` = `root.a.b`, atau null bila ada
 * mata rantai yang bukan objek. Menggantikan pola `a?.b?.c` pada nilai `any`.
 */
export function pick(root: unknown, ...path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    const rec = asRecord(cur);
    if (!rec) return null;
    cur = rec[key];
  }
  return cur;
}

/**
 * `createdEvent` dari satu entri ACS (bentuk verbose). null bila entri tidak
 * memuatnya — pemanggil melewati entri tersebut, seperti perilaku sebelumnya.
 */
export function readAcsCreatedEvent(
  entry: unknown,
): Record<string, unknown> | null {
  return asRecord(
    pick(entry, 'contractEntry', 'JsActiveContract', 'createdEvent'),
  );
}

/**
 * Daftar `createdEvent` dari respons `/v2/state/active-contracts`. Respons yang
 * bukan array dianggap kosong (setara `Array.isArray(arr) ? arr : []`).
 */
export function readAcsCreatedEvents(
  json: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(json)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const entry of json) {
    const ev = readAcsCreatedEvent(entry);
    if (ev) out.push(ev);
  }
  return out;
}
