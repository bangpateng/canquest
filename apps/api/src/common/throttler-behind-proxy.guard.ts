import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit per real client IP when behind nginx / Vercel BFF.
 * Requires `app.set('trust proxy', 1)` in main.ts and X-Forwarded-For on upstream.
 *
 * SECURITY: gunakan `req.ip` (yang sudah memperhitungkan `trust proxy`).
 * JANGAN pakai `req.ips[0]` (leftmost X-Forwarded-For) — itu nilai yang
 * paling mudah dipalsukan klien, sehingga attacker cukup mengirim header
 * `X-Forwarded-For: <random>` untuk mendapat bucket throttle baru setiap
 * request dan menggagalkan seluruh rate-limiting. Dengan `trust proxy=1`,
 * `req.ip` adalah alamat tepat sebelum hop proxy tepercaya kita (nginx/BFF),
 * yang tidak bisa dipalsukan oleh klien akhir.
 * @see https://docs.nestjs.com/security/rate-limiting
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as { ip?: string; ips?: string[] };
    // `req.ip` sudah memperhitungkan trust proxy → IP paling kanan yang trusted.
    const tracker = r.ip;
    return tracker ?? 'unknown';
  }
}
