import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

/**
 * In-memory registry koneksi SSE aktif, dikelompokkan per userId.
 *
 * Karena API jalan sebagai single PM2 instance (fork, bukan cluster), registry
 * ini cukup disimpan di memori proses — tidak butuh Redis adapter untuk
 * sinkronisasi antar-instance. Lihat infra/pm2.ecosystem.config.js
 * (canquest-api: instances:1, exec_mode:'fork').
 *
 * Tiap user bisa punya beberapa koneksi (multiple tab) → disimpan sebagai Set.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  /** userId → set of Express responses (SSE streams) */
  private readonly clients = new Map<string, Set<Response>>();

  /** Daftarkan koneksi SSE untuk seorang user. */
  addClient(userId: string, res: Response): void {
    let set = this.clients.get(userId);
    if (!set) {
      set = new Set();
      this.clients.set(userId, set);
    }
    set.add(res);
    this.logger.debug(`+client user=${userId} (total ${set.size})`);
  }

  /** Hapus koneksi SSE (saat user tutup tab / koneksi putus). */
  removeClient(userId: string, res: Response): void {
    const set = this.clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.clients.delete(userId);
    this.logger.debug(`-client user=${userId} (total ${set.size})`);
  }

  /**
   * Push event SSE ke SEMUA koneksi milik seorang user.
   * Format pesan sesuai spec Server-Sent Events:
   *   event: <eventName>\n
   *   data: <json>\n\n
   *
   * No-op bila user tidak punya koneksi aktif (mis. sedang offline).
   */
  push(userId: string, event: string, data: unknown): void {
    const set = this.clients.get(userId);
    if (!set || set.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch (err) {
        // Koneksi mungkin sudah mati — cleanup diam-diam.
        this.logger.debug(
          `write failed user=${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        set.delete(res);
      }
    }
    if (set.size === 0) this.clients.delete(userId);
  }

  /** Jumlah total koneksi aktif (untuk monitoring/debug). */
  get totalConnections(): number {
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }
}
