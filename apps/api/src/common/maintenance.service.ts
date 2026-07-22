import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AppSetting keys yang dipakai untuk mode maintenance.
 * Disimpan di tabel AppSetting (live, bisa diubah tanpa restart/migrasi).
 */
export const MAINTENANCE_KEYS = {
  enabled: 'maintenance_mode',
  title: 'maintenance_title',
  message: 'maintenance_message',
  estimatedEnd: 'maintenance_estimated_end',
} as const;

export interface MaintenanceStatus {
  enabled: boolean;
  title: string;
  message: string;
  /** ISO string atau null. */
  estimatedEnd: string | null;
}

export interface SetMaintenanceInput {
  enabled: boolean;
  title?: string;
  message?: string;
  estimatedEnd?: string | null;
}

const DEFAULT_TITLE = 'CanQuest sedang dalam pemeliharaan';
const DEFAULT_MESSAGE =
  'Kami sedang melakukan pembaruan untuk meningkatkan pengalaman Anda. Semua aktivitas dihentikan sementara. Silakan kembali lagi nanti.';

/**
 * Sumber kebenaran tunggal untuk status maintenance.
 *
 * Cache in-memory TTL 60 detik supaya guard (yang jalan di setiap request) tidak
 * membombardir DB. Maintenance status jarang berubah (toggle manual admin) →
 * TTL panjang aman + hemat koneksi DB.
 *
 * FAIL-OPEN: bila DB error saat membaca → pakai cache lama bila ada (jangan
 * hapus cache), supaya saat DB sibuk/timeout kita tidak terus-terusan retry
 * query yang gagal (itulah yang bikin pool makin penuh → login 504). Kalau
 * belum ada cache sama sekali → anggap OFF (fail-open).
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  /** Cache snapshot + timestamp kadaluarsa (ms). */
  private cache: { value: MaintenanceStatus; expiresAt: number } | null = null;
  private readonly ttlMs = 60_000;

  /** Bypass lokal (development) — paksa status OFF walau DB bilang ON.
   *  Dipakai saat API lokal berbagi DATABASE_URL dengan production: kita ingin
   *  production tetap maintenance (untuk user), tapi local dev tetap jalan. */
  private readonly localBypass =
    process.env.MAINTENANCE_LOCAL_BYPASS === 'true' ||
    process.env.MAINTENANCE_LOCAL_BYPASS === '1';

  constructor(private readonly prisma: PrismaService) {
    if (this.localBypass) {
      this.logger.warn(
        'MAINTENANCE_LOCAL_BYPASS aktif — status maintenance selalu OFF di ' +
          'instance ini walau DB (production) mengatakan ON. Jangan aktifkan di VPS!',
      );
    }
  }

  /**
   * Baca status maintenance (dari cache bila masih segar, atau DB).
   *
   * Chokepoint tunggal: guard, /public/maintenance, dan frontend SEMUA lewat
   * sini. Jadi bypass lokal di method ini menonaktifkan SEMUA layer sekaligus.
   */
  async getStatus(): Promise<MaintenanceStatus> {
    // Local dev bypass: paksa OFF supaya lokal tidak ikut maintenance production.
    if (this.localBypass) return this.disabledStatus();

    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    try {
      const value = await this.readFromDb();
      this.cache = { value, expiresAt: now + this.ttlMs };
      return value;
    } catch (err) {
      this.logger.warn(
        `Gagal membaca status maintenance dari DB (cached fail-open): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // WAJIB cache hasil fail-open supaya TIDAK retry tiap request.
      // Bug sebelumnya: saat query gagal, cache tidak ter-set → setiap request
      // retry query yang sama yang gagal → death spiral (pool exhaustion).
      // Fix: cache hasil fail-open (OFF) untuk TTL durasi, baru retry setelah itu.
      const value = this.cache?.value ?? this.disabledStatus();
      this.cache = { value, expiresAt: now + this.ttlMs };
      return value;
    }
  }

  /**
   * Tulis status maintenance. Upsert tiap key + invalidate cache.
   */
  async setStatus(input: SetMaintenanceInput): Promise<MaintenanceStatus> {
    const title = (input.title ?? '').trim() || DEFAULT_TITLE;
    const message = (input.message ?? '').trim() || DEFAULT_MESSAGE;
    const estimatedEnd = input.estimatedEnd ? input.estimatedEnd.trim() : null;

    const entries: { key: string; value: string }[] = [
      { key: MAINTENANCE_KEYS.enabled, value: input.enabled ? 'true' : 'false' },
      { key: MAINTENANCE_KEYS.title, value: title },
      { key: MAINTENANCE_KEYS.message, value: message },
      { key: MAINTENANCE_KEYS.estimatedEnd, value: estimatedEnd ?? '' },
    ];

    // Upsert berurutan — AppSetting tidak punya unique constraint ganda.
    for (const e of entries) {
      await this.prisma.appSetting.upsert({
        where: { key: e.key },
        update: { value: e.value },
        create: { key: e.key, value: e.value },
      });
    }

    // Invalidate cache agar baca berikutnya langsung akurat.
    this.cache = null;
    this.logger.warn(
      `Maintenance mode ${input.enabled ? 'AKTIF' : 'NONAKTIF'} — title="${title}"`,
    );
    return this.getStatus();
  }

  private async readFromDb(): Promise<MaintenanceStatus> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: Object.values(MAINTENANCE_KEYS) } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const enabledRaw = map.get(MAINTENANCE_KEYS.enabled);
    const enabled = enabledRaw === 'true';
    const title = (map.get(MAINTENANCE_KEYS.title) ?? '').trim() || DEFAULT_TITLE;
    const message =
      (map.get(MAINTENANCE_KEYS.message) ?? '').trim() || DEFAULT_MESSAGE;
    const estimatedEndRaw = (map.get(MAINTENANCE_KEYS.estimatedEnd) ?? '').trim();
    const estimatedEnd = estimatedEndRaw || null;

    return { enabled, title, message, estimatedEnd };
  }

  private disabledStatus(): MaintenanceStatus {
    return {
      enabled: false,
      title: DEFAULT_TITLE,
      message: DEFAULT_MESSAGE,
      estimatedEnd: null,
    };
  }
}
