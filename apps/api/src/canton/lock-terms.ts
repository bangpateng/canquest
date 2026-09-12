import { Logger } from '@nestjs/common';

/**
 * Term options untuk CC Lock — dibaca dari env LOCK_TERM_OPTIONS (Spec CC Lock, ATURAN EMAS #3).
 *
 * Format: "label:detik" dipisah koma. TIDAK di-hard-code — bisa ganti detik/menit untuk
 * uji cepat, lalu hari di produksi TANPA ubah kode.
 *   Produksi:   LOCK_TERM_OPTIONS=7d:604800,15d:1296000,30d:2592000
 *   Uji cepat:  LOCK_TERM_OPTIONS=2m:120,5m:300,10m:600
 *
 * MODE OPEN (2026-09-12): pilihan durasi DIHAPUS dari UI. Semua lock sekarang
 * term 'open' — tanpa batas waktu, dana terkunci sampai user sendiri unlock.
 * Yang tersisa hanya MASA TUNGGU MINIMUM sebelum unlock boleh dilakukan:
 * `OPEN_LOCK_SECONDS` (2 menit). On-chain `expiresAt = lockedAt + 120s` membuat
 * choice `LockedAmulet_OwnerExpireLockV2` tersedia tepat saat masa tunggu habis —
 * setelah itu dana TETAP terkunci sampai user yang meng-exercise.
 */
export interface LockTermOption {
  /** key asli dari env, mis. "15d" atau "5m" */
  key: string;
  /** durasi efektif dalam detik */
  seconds: number;
  /** label untuk UI — key apa adanya (UI format sendiri ke "15 hari"/"5 menit") */
  label: string;
}

/** termKey untuk lock mode open (tanpa batas waktu). */
export const OPEN_TERM_KEY = 'open';

/** Masa tunggu minimum sebelum unlock boleh dilakukan (detik). */
export const OPEN_LOCK_SECONDS = 120;

/** Sentinel lockSeconds untuk lock mode open — durasi TIDAK ditentukan saat lock. */
export const OPEN_LOCK_SECONDS_SENTINEL = 0;

/**
 * Parse LOCK_TERM_OPTIONS dari env string → map { key -> seconds } + list options.
 * Robust: skip entry kosong/non-numerik, dedupe by key, log warning jika env kosong.
 */
export function parseLockTerms(envValue: string | undefined): {
  map: Map<string, number>;
  options: LockTermOption[];
} {
  const map = new Map<string, number>();
  const options: LockTermOption[] = [];
  if (!envValue || !envValue.trim()) {
    return { map, options };
  }
  const logger = new Logger('LockTerms');
  const seen = new Set<string>();
  for (const raw of envValue.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    const sep = entry.lastIndexOf(':');
    if (sep <= 0) {
      logger.warn(
        `LOCK_TERM_OPTIONS entry "${entry}" malformed (expected "label:seconds") — skipped`,
      );
      continue;
    }
    const key = entry.slice(0, sep).trim();
    const seconds = Number(entry.slice(sep + 1).trim());
    if (!key || !Number.isFinite(seconds) || seconds <= 0) {
      logger.warn(
        `LOCK_TERM_OPTIONS entry "${entry}" invalid seconds — skipped`,
      );
      continue;
    }
    if (seen.has(key)) {
      logger.warn(
        `LOCK_TERM_OPTIONS duplicate key "${key}" — using first occurrence`,
      );
      continue;
    }
    seen.add(key);
    map.set(key, Math.floor(seconds));
    options.push({ key, seconds: Math.floor(seconds), label: key });
  }
  return { map, options };
}
