import { ConfigService } from '@nestjs/config';
import { TwitterCacheService } from './twitter-cache.service';

/**
 * Unit test untuk TwitterCacheService.
 *
 * Untuk menghindari koneksi Redis asli saat test, kita pakai
 * TWITTER_CACHE_ENABLED=false sehingga service jalan dalam mode "disabled":
 * semua get return null (miss) dan set no-op. Ini sekaligus menguji kontrak
 * graceful-degradation yang menjadi jaminan utama service ini.
 *
 * Key building & TTL diuji secara langsung (pure logic).
 */

const makeConfig = (overrides: Record<string, string> = {}): ConfigService =>
  ({
    get: (key: string) =>
      ({
        TWITTER_CACHE_ENABLED: 'false',
        TWITTER_CACHE_KEY_PREFIX: 'tcache',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
        ...overrides,
      })[key],
  }) as unknown as ConfigService;

describe('TwitterCacheService (disabled mode — no Redis)', () => {
  let svc: TwitterCacheService;

  beforeEach(() => {
    svc = new TwitterCacheService(makeConfig());
  });

  afterEach(() => {
    svc.onModuleDestroy();
  });

  describe('key building', () => {
    it('membuat key follow dengan prefix + source + target', () => {
      expect(svc.followKey('alice', 'bob')).toBe('tcache:follow:alice:bob');
    });

    it('membuat key retweet dengan prefix + user + tweetId', () => {
      expect(svc.retweetKey('alice', '123456')).toBe(
        'tcache:retweet:alice:123456',
      );
    });

    it('membuat key profile dengan prefix + handle', () => {
      expect(svc.profileKey('alice')).toBe('tcache:profile:alice');
    });

    it('membuat key cooldown dengan prefix + userId + taskId', () => {
      expect(svc.cooldownKey('user-1', 'task-9')).toBe(
        'tcache:cd:user-1:task-9',
      );
    });

    it('menghormati prefix custom dari env', () => {
      const custom = new TwitterCacheService(
        makeConfig({
          TWITTER_CACHE_ENABLED: 'false',
          TWITTER_CACHE_KEY_PREFIX: 'twc',
        }),
      );
      expect(custom.followKey('a', 'b')).toBe('twc:follow:a:b');
      custom.onModuleDestroy();
    });
  });

  describe('TTL constants', () => {
    it('positif follow/retweet lebih panjang dari negatif (anti boros)', () => {
      expect(TwitterCacheService.TTL.FOLLOW_POSITIVE_SEC).toBeGreaterThan(
        TwitterCacheService.TTL.FOLLOW_NEGATIVE_SEC,
      );
      expect(TwitterCacheService.TTL.RETWEET_POSITIVE_SEC).toBeGreaterThan(
        TwitterCacheService.TTL.RETWEET_NEGATIVE_SEC,
      );
    });

    it('profile positif 24 jam', () => {
      expect(TwitterCacheService.TTL.PROFILE_POSITIVE_SEC).toBe(24 * 60 * 60);
    });

    it('profile gagal 5 menit (cegah retry storm)', () => {
      expect(TwitterCacheService.TTL.PROFILE_FAIL_SEC).toBe(5 * 60);
    });

    it('negatif follow/retweet >= 60 dtk (window propagasi X)', () => {
      expect(
        TwitterCacheService.TTL.FOLLOW_NEGATIVE_SEC,
      ).toBeGreaterThanOrEqual(60);
      expect(
        TwitterCacheService.TTL.RETWEET_NEGATIVE_SEC,
      ).toBeGreaterThanOrEqual(60);
    });
  });

  describe('graceful degradation (Redis unavailable)', () => {
    it('getFollow returns null (cache miss) — tidak throw', async () => {
      await expect(svc.getFollow('a', 'b')).resolves.toBeNull();
    });

    it('getRetweet returns null (cache miss) — tidak throw', async () => {
      await expect(svc.getRetweet('a', '123')).resolves.toBeNull();
    });

    it('getProfile returns null (cache miss) — tidak throw', async () => {
      await expect(svc.getProfile('a')).resolves.toBeNull();
    });

    it('setFollow no-op — tidak throw', async () => {
      await expect(svc.setFollow('a', 'b', true)).resolves.toBeUndefined();
      await expect(svc.setFollow('a', 'b', false)).resolves.toBeUndefined();
    });

    it('setRetweet no-op — tidak throw', async () => {
      await expect(svc.setRetweet('a', '1', true)).resolves.toBeUndefined();
    });

    it('setProfile no-op — tidak throw', async () => {
      await expect(svc.setProfile('a', '{}', 60)).resolves.toBeUndefined();
    });

    it('acquireCooldown returns true (tidak blokir) — tidak throw', async () => {
      // Kontrak kunci: Redis down → verify TIDAK boleh diblokir cooldown.
      await expect(svc.acquireCooldown('tcache:cd:u:t', 15)).resolves.toBe(
        true,
      );
    });
  });
});
