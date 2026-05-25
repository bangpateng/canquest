import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate-limit per real client IP when behind nginx / Vercel BFF.
 * Requires `app.set('trust proxy', 1)` in main.ts and X-Forwarded-For on upstream.
 * @see https://docs.nestjs.com/security/rate-limiting
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as { ip?: string; ips?: string[] };
    const tracker = r.ips?.length ? r.ips[0] : r.ip;
    return tracker ?? 'unknown';
  }
}
