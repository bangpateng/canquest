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
 * Cache in-memory TTL 5 detik supaya guard (yang jalan di setiap request) tidak
 * membombardir DB. TTL pendek cukup karena toggle hanya dilakukan admin manual.
 *
 * FAIL-OPEN: bila DB error saat membaca → anggap OFF, supaya admin tetap bisa
 * login & memperbaiki situasi (tidak pernah terkunci keluar dari panel).
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  /** Cache snapshot + timestamp kadaluarsa (ms). */
  private cache: { value: MaintenanceStatus; expiresAt: number } | null = null;
  private readonly ttlMs = 5_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Baca status maintenance (dari cache bila masih segar, atau DB).
   */
  async getStatus(): Promise<MaintenanceStatus> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    const value = await this.readFromDb().catch((err) => {
      this.logger.error(
        `Gagal membaca status maintenance dari DB (fail-open = OFF): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Fail-open: anggap OFF.
      return this.disabledStatus();
    });

    this.cache = { value, expiresAt: now + this.ttlMs };
    return value;
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
