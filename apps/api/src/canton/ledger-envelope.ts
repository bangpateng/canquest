/**
 * ledger-envelope — normalisasi envelope MENTAH yang tersimpan di
 * `LedgerUpdate.envelope` menjadi bentuk `CantonUpdateEvent` (created /
 * archived / exercised) yang dipakai seluruh pembaca semantik.
 *
 * MASALAH yang diselesaikan (regresi senyap):
 *   Raw layer ditulis oleh DUA penulis dengan bentuk envelope BERBEDA:
 *
 *   (1) `LedgerRawIngestService` (jalur WSS live) menulis key FLAT:
 *       { updateId, commandId, effectiveAt, created: [], archived: [], exercised: [] }
 *
 *   (2) `scripts/ledger-backfill.cjs` (jalur backfill historis) menulis key
 *       `events` berisi array wrapper PascalCase:
 *       { updateId, ..., events: [{ExercisedEvent:{...}}, {CreatedEvent:{...}}] }
 *
 *   Tool rekonstruksi lama (`reconstruct-history-airplanestar.ts`,
 *   `regen-from-ledger-airplanestar.ts`, `replay-swap-out-legs.ts`) membaca
 *   HANYA bentuk (1) — `env.created` / `env.archived` / `env.exercised`.
 *   Untuk baris hasil backfill (mayoritas data historis) ketiganya `undefined`
 *   → `[]` → tool melihat NOL event dan menyimpulkan "data mentah tidak ada",
 *   padahal event-nya lengkap tersimpan di `envelope.events`.
 *
 * Ini murni masalah BACA (read-side): tidak ada data yang hilang dan tidak ada
 * penulisan yang perlu diubah. Normalizer ini menyatukan kedua bentuk supaya
 * semua pembaca melihat event yang sama.
 *
 * PURE: tanpa DB / state / jaringan.
 */

/** Bentuk minimal event mentah yang dibutuhkan pembaca semantik. */
export interface NormalizedEnvelopeEvents {
  created: Array<Record<string, unknown>>;
  archived: Array<Record<string, unknown>>;
  exercised: Array<Record<string, unknown>>;
}

/** Wrapper PascalCase di dalam `envelope.events[]` (jalur backfill). */
const WRAPPER_KEYS = [
  'CreatedEvent',
  'ArchivedEvent',
  'ExercisedEvent',
] as const;

/** String bila nilainya string; selain itu '' (tanpa stringify objek). */
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Identitas event untuk dedup: contractId|templateId|choice. */
function eventKey(e: Record<string, unknown>): string {
  return `${str(e.contractId)}|${str(e.templateId)}|${str(e.choice)}`;
}

/** Klasifikasi satu elemen `events[]` ke created/archived/exercised. */
function classifyWrapper(item: unknown): {
  kind: 'created' | 'archived' | 'exercised';
  value: Record<string, unknown>;
} | null {
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;

  // Bentuk flat lowercase di dalam events[] (varian wire): { created: {...} }.
  if (obj.created && typeof obj.created === 'object') {
    return { kind: 'created', value: obj.created as Record<string, unknown> };
  }
  if (obj.archived && typeof obj.archived === 'object') {
    return { kind: 'archived', value: obj.archived as Record<string, unknown> };
  }
  if (obj.exercised && typeof obj.exercised === 'object') {
    return {
      kind: 'exercised',
      value: obj.exercised as Record<string, unknown>,
    };
  }

  // Bentuk PascalCase (backfill + transaction-tree wire).
  for (const key of WRAPPER_KEYS) {
    const value = obj[key];
    if (value && typeof value === 'object') {
      const kind =
        key === 'CreatedEvent'
          ? 'created'
          : key === 'ArchivedEvent'
            ? 'archived'
            : 'exercised';
      return { kind, value: value as Record<string, unknown> };
    }
  }

  // Fallback terakhir: event sudah membawa penanda eventType eksplisit.
  const et = obj.eventType;
  if (et === 'created' || et === 'archived' || et === 'exercised') {
    return { kind: et, value: obj };
  }
  return null;
}

/**
 * Normalisasi envelope tersimpan → { created, archived, exercised }.
 *
 * Sumber diutamakan dari key FLAT bila ada dan berisi (bentuk raw-ingest),
 * lalu MELENGKAPI dari `events[]` (bentuk backfill). Bila keduanya ada,
 * event dari `events[]` yang belum terwakili tetap ditambahkan — dedup
 * berdasarkan contractId+choice+templateId supaya tidak menggandakan.
 *
 * Aman untuk envelope null / shape tak dikenal → semua array kosong.
 */
export function normalizeStoredEnvelope(
  envelope: unknown,
): NormalizedEnvelopeEvents {
  const out: NormalizedEnvelopeEvents = {
    created: [],
    archived: [],
    exercised: [],
  };
  if (!envelope || typeof envelope !== 'object') return out;
  const env = envelope as Record<string, unknown>;

  const push = (
    kind: 'created' | 'archived' | 'exercised',
    value: unknown,
  ): void => {
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    // Dedup: identitas event = contractId + templateId + choice (string saja;
    // nilai non-string diperlakukan tanpa identitas, tidak di-stringify).
    const key = `${str(v.contractId)}|${str(v.templateId)}|${str(v.choice)}`;
    if (key !== '||' && out[kind].some((e) => eventKey(e) === key)) {
      return;
    }
    out[kind].push(v);
  };

  // 1. Key flat (raw-ingest live) — sumber utama.
  for (const c of Array.isArray(env.created) ? env.created : []) {
    push('created', c);
  }
  for (const a of Array.isArray(env.archived) ? env.archived : []) {
    push('archived', a);
  }
  for (const x of Array.isArray(env.exercised) ? env.exercised : []) {
    push('exercised', x);
  }

  // 2. Key `events[]` (backfill historis) — lengkapi.
  for (const item of Array.isArray(env.events) ? env.events : []) {
    const classified = classifyWrapper(item);
    if (classified) push(classified.kind, classified.value);
  }

  return out;
}
