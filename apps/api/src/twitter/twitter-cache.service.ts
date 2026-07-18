import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * TwitterCacheService — cache hasil panggilan twitterapi.io di Redis.
 *
 * Kenapa cache?
 *   - Setiap verify task (follow/retweet) sebelumnya = 1–5 live API call ke
 *     twitterapi.io. Tanpa cache, user yang spam tombol Verify langsung boros kuota.
 *   - Hasil follow/retweet itu stabil (jarang berubah dalam menitan), jadi aman
 *     di-cache beberapa jam untuk positif, dan window pendek untuk negatif.
 *
 * Graceful degradation:
 *   - Redis opsional. Bila gagal connect / down saat runtime, semua method get
 *     return null (= cache miss) dan set no-op. Verify tetap jalan normal,
 *     hanya tidak hemat API. Worker dianggap unavailable sampai connect ulang.
 *
 * Key scheme: prefix `tcache:` (default) supaya tidak bentrok dengan BullMQ.
 *
 * TTL:
 *   - Follow positif  : 6 jam  (follow stabil)
 *   - Follow negatif  : 90 dtk (window aman: countdown 5s + margin propagasi X)
 *   - Retweet positif : 6 jam
 *   - Retweet negatif : 90 dtk
 *   - Profile positif : 24 jam (data profile stabil)
 *   - Profile gagal   : 5 menit (cegah retry storm)
 *   - Cooldown        : diatur caller (default 15s anti double-click)
 */
@Injectable()
export class TwitterCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(TwitterCacheService.name);
  private readonly prefix: string;
  private readonly enabled: boolean;
  private redis: Redis | null = null;
  private warnedUnavailable = false;

  /** TTL dalam detik. Dikonstantakan agar mudah ditest & diubah. */
  static readonly TTL = {
    FOLLOW_POSITIVE_SEC: 6 * 60 * 60, // 6 jam
    FOLLOW_NEGATIVE_SEC: 90,
    RETWEET_POSITIVE_SEC: 6 * 60 * 60, // 6 jam
    RETWEET_NEGATIVE_SEC: 90,
    PROFILE_POSITIVE_SEC: 24 * 60 * 60, // 24 jam
    PROFILE_FAIL_SEC: 5 * 60, // 5 menit
  } as const;

  constructor(private readonly config: ConfigService) {
    this.enabled =
      this.config.get<string>('TWITTER_CACHE_ENABLED')?.toLowerCase() !==
      'false';
    this.prefix =
      this.config.get<string>('TWITTER_CACHE_KEY_PREFIX')?.trim() || 'tcache';
    if (this.enabled) {
      this.initRedis();
    }
  }

  private initRedis(): void {
    try {
      const host = this.config.get<string>('REDIS_HOST') ?? '127.0.0.1';
      const port = Number(this.config.get<string>('REDIS_PORT') ?? '6379');
      const password =
        this.config.get<string>('REDIS_PASSWORD')?.trim() || undefined;

      this.redis = new Redis({
        host,
        port,
        password,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        // Reconnect otomatis, tapi tidak spam.
        retryStrategy: (times: number) => Math.min(times * 200, 5_000),
      });

      this.redis.on('error', (err) => {
        if (!this.warnedUnavailable) {
          this.logger.warn(
            `Twitter cache Redis unavailable — verify tetap jalan tanpa cache. ${err.message}`,
          );
          this.warnedUnavailable = true;
        }
      });
      this.redis.on('ready', () => {
        if (this.warnedUnavailable) {
          this.logger.log('Twitter cache Redis kembali online.');
          this.warnedUnavailable = false;
        }
      });

      // Connect secara lazy; bila gagal, available() akan false.
      this.redis.connect().catch((err: unknown) => {
        this.markUnavailable(err);
      });
    } catch (err) {
      this.markUnavailable(err);
    }
  }

  private markUnavailable(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (!this.warnedUnavailable) {
      this.logger.warn(
        `Twitter cache Redis tidak dapat dihubungi — cache di-skip. ${msg}`,
      );
      this.warnedUnavailable = true;
    }
    // Pastikan instance rusak tidak dipakai.
    try {
      this.redis?.disconnect();
    } catch {
      // ignore.
    }
    this.redis = null;
  }

  /** True hanya bila caching aktif & Redis siap dipakai. */
  private available(): boolean {
    return this.enabled && this.redis !== null && this.redis.status === 'ready';
  }

  // ── Key builders ──────────────────────────────────────────────
  followKey(source: string, target: string): string {
    return `${this.prefix}:follow:${source}:${target}`;
  }
  retweetKey(username: string, tweetId: string): string {
    return `${this.prefix}:retweet:${username}:${tweetId}`;
  }
  profileKey(handle: string): string {
    return `${this.prefix}:profile:${handle}`;
  }
  cooldownKey(userId: string, taskId: string): string {
    return `${this.prefix}:cd:${userId}:${taskId}`;
  }

  // ── Generic get/set boolean (untuk follow & retweet) ─────────
  private async getBool(key: string): Promise<boolean | null> {
    if (!this.available()) return null;
    try {
      const raw = await this.redis!.get(key);
      if (raw === null || raw === undefined) return null;
      return raw === '1';
    } catch {
      return null;
    }
  }

  private async setBool(
    key: string,
    value: boolean,
    ttlSec: number,
  ): Promise<void> {
    if (!this.available()) return;
    try {
      await this.redis!.set(key, value ? '1' : '0', 'EX', ttlSec);
    } catch {
      // no-op: cache gagal tidak boleh menggagalkan verify.
    }
  }

  // ── Follow ────────────────────────────────────────────────────
  getFollow(source: string, target: string): Promise<boolean | null> {
    return this.getBool(this.followKey(source, target));
  }
  setFollow(
    source: string,
    target: string,
    value: boolean,
    ttlOverride?: number,
  ): Promise<void> {
    const ttl =
      ttlOverride ??
      (value
        ? TwitterCacheService.TTL.FOLLOW_POSITIVE_SEC
        : TwitterCacheService.TTL.FOLLOW_NEGATIVE_SEC);
    return this.setBool(this.followKey(source, target), value, ttl);
  }

  // ── Retweet ───────────────────────────────────────────────────
  getRetweet(username: string, tweetId: string): Promise<boolean | null> {
    return this.getBool(this.retweetKey(username, tweetId));
  }
  setRetweet(
    username: string,
    tweetId: string,
    value: boolean,
    ttlOverride?: number,
  ): Promise<void> {
    const ttl =
      ttlOverride ??
      (value
        ? TwitterCacheService.TTL.RETWEET_POSITIVE_SEC
        : TwitterCacheService.TTL.RETWEET_NEGATIVE_SEC);
    return this.setBool(this.retweetKey(username, tweetId), value, ttl);
  }

  // ── Profile (JSON string; caller yang serialize) ──────────────
  async getProfile(handle: string): Promise<string | null> {
    if (!this.available()) return null;
    try {
      return await this.redis!.get(this.profileKey(handle));
    } catch {
      return null;
    }
  }

  async setProfile(
    handle: string,
    json: string,
    ttlSec: number,
  ): Promise<void> {
    if (!this.available()) return;
    try {
      await this.redis!.set(this.profileKey(handle), json, 'EX', ttlSec);
    } catch {
      // no-op.
    }
  }

  // ── Cooldown (anti double-click / replay) ─────────────────────
  /**
   * Coba dapatkan slot cooldown. Return true bila BERHASIL (slot belum ada),
   * false bila masih dalam cooldown. SET NX EX → atomic.
   */
  async acquireCooldown(key: string, sec: number): Promise<boolean> {
    if (!this.available()) return true; // Redis down = jangan blokir.
    try {
      const ok = await this.redis!.set(key, '1', 'EX', sec, 'NX');
      return ok === 'OK';
    } catch {
      return true; // aman: jangan blokir verify bila Redis error.
    }
  }

  // ── OAuth state (Twitter OAuth 2.0 PKCE flow) ────────────────
  /**
   * Simpan mapping state → { userId, codeVerifier } untuk PKCE flow.
   * TTL 10 menit (lebih panjang dari follow-through user normal).
   * Return true bila berhasil disimpan.
   */
  async setOAuthState(
    state: string,
    payload: { userId: string; codeVerifier: string },
    ttlSec = 600,
  ): Promise<boolean> {
    if (!this.available()) return false;
    try {
      await this.redis!.set(
        this.oauthStateKey(state),
        JSON.stringify(payload),
        'EX',
        ttlSec,
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ambil & hapus payload OAuth state (one-shot consume — PKCE state tidak
   * boleh dipakai ulang). Return null bila state tidak ada / Redis down.
   */
  async consumeOAuthState(state: string): Promise<{
    userId: string;
    codeVerifier: string;
  } | null> {
    if (!this.available()) return null;
    const key = this.oauthStateKey(state);
    try {
      const raw = await this.redis!.getdel(key);
      if (!raw) return null;
      return JSON.parse(raw) as { userId: string; codeVerifier: string };
    } catch {
      return null;
    }
  }

  oauthStateKey(state: string): string {
    return `${this.prefix}:oauth-state:${state}`;
  }

  onModuleDestroy(): void {
    try {
      this.redis?.disconnect();
    } catch {
      // ignore.
    }
  }
}
