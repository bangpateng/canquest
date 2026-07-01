import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  pickTwitterDisplayName,
  pickTwitterProfileImage,
} from './twitter-avatar.util';
import { TwitterCacheService } from './twitter-cache.service';
import {
  normalizeTwitterUsername,
  parseTweetIdFromTarget,
  parseTwitterFollowTarget,
} from './twitter-target.util';

export type TwitterUserProfile = {
  username: string;
  userId: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
};

type TwitterApiEnvelope<T> = {
  status?: string;
  message?: string;
  data?: T;
};

/**
 * Konversi nilai `unknown` (dari JSON API) ke string secara aman.
 * Hindari `String(obj)` yang menghasilkan `'[object Object]'` untuk object.
 */
function toSafeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

@Injectable()
export class TwitterApiService {
  private readonly logger = new Logger(TwitterApiService.name);
  private readonly baseUrl = 'https://api.twitterapi.io';

  constructor(
    private readonly config: ConfigService,
    private readonly cache: TwitterCacheService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('TWITTERAPI_IO_KEY')?.trim());
  }

  private apiKey(): string {
    const key = this.config.get<string>('TWITTERAPI_IO_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'Twitter verification is not configured (TWITTERAPI_IO_KEY).',
      );
    }
    return key;
  }

  private async getJson<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': this.apiKey() },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as TwitterApiEnvelope<T> &
      T;
    if (!res.ok) {
      const errBody = body as { message?: string; error?: number };
      const msg =
        errBody.message?.trim() ||
        (body as TwitterApiEnvelope<T>).message?.trim() ||
        `Twitter API HTTP ${res.status}`;
      this.logger.warn(`twitterapi.io ${path}: ${msg}`);
      throw new BadRequestException(msg);
    }
    if ((body as TwitterApiEnvelope<T>).status === 'error') {
      throw new BadRequestException(
        (body as TwitterApiEnvelope<T>).message ?? 'Twitter API error',
      );
    }
    return body;
  }

  /** Validate handle exists on X and return canonical username + id when available. */
  async resolveUser(
    username: string,
  ): Promise<{ username: string; userId: string | null }> {
    const profile = await this.fetchUserProfile(username);
    return { username: profile.username, userId: profile.userId };
  }

  /** Full profile for registration / leaderboard avatars (twitterapi.io). */
  async fetchUserProfile(username: string): Promise<TwitterUserProfile> {
    const name = normalizeTwitterUsername(username);
    if (!name || !/^[a-z0-9_]{1,15}$/i.test(name)) {
      throw new BadRequestException('Invalid X username.');
    }

    // Cache hit → hindari hit API. Profile stabil (24 jam).
    const cached = await this.cache.getProfile(name);
    if (cached) {
      try {
        return JSON.parse(cached) as TwitterUserProfile;
      } catch {
        // JSON corrupt → anggap miss, lanjut fetch.
      }
    }

    const payload = await this.getJson<Record<string, unknown>>(
      '/twitter/user/info',
      {
        userName: name,
      },
    );
    const envelope = payload as TwitterApiEnvelope<Record<string, unknown>>;
    const data = envelope.data ?? payload;
    const nested =
      data.user && typeof data.user === 'object'
        ? (data.user as Record<string, unknown>)
        : data;
    const resolvedRaw =
      nested.userName ??
      nested.screen_name ??
      nested.username ??
      data.userName ??
      name;
    const resolved = normalizeTwitterUsername(
      toSafeString(resolvedRaw).replace(/^@/, ''),
    );
    const idRaw = nested.id ?? nested.userId ?? data.id;
    const profile: TwitterUserProfile = {
      username: resolved,
      userId: idRaw != null ? toSafeString(idRaw).trim() : null,
      displayName: pickTwitterDisplayName(data),
      profileImageUrl: pickTwitterProfileImage(data),
    };
    // Profile positif di-cache 24 jam. Bila resolve melempar (di atas),
    // tidak di-cache di sini — caller (settings/leaderboard) menangani error.
    await this.cache.setProfile(
      name,
      JSON.stringify(profile),
      TwitterCacheService.TTL.PROFILE_POSITIVE_SEC,
    );
    return profile;
  }

  async userFollowsTarget(
    sourceUsername: string,
    targetUsername: string,
  ): Promise<boolean> {
    const source = normalizeTwitterUsername(sourceUsername);
    const target = normalizeTwitterUsername(targetUsername);
    if (!source || !target) return false;

    // Cache hit → hindari hit API. Follow stabil.
    const cached = await this.cache.getFollow(source, target);
    if (cached !== null) return cached;

    const payload = await this.getJson<{
      following?: boolean;
      followed_by?: boolean;
    }>('/twitter/user/check_follow_relationship', {
      source_user_name: source,
      target_user_name: target,
    });
    const data =
      (payload as TwitterApiEnvelope<{ following?: boolean }>).data ?? payload;
    const following = Boolean(data.following);
    await this.cache.setFollow(source, target, following);
    return following;
  }

  /** Check if user retweeted a tweet (scans retweeters list, limited pages). */
  async userRetweetedTweet(
    username: string,
    tweetId: string,
  ): Promise<boolean> {
    const needle = normalizeTwitterUsername(username);
    if (!needle || !tweetId) return false;

    // Cache hit → hindari hit API. Retweet positif stabil (6 jam).
    const cached = await this.cache.getRetweet(needle, tweetId);
    if (cached !== null) return cached;

    let cursor = '';
    const maxPages = 5;
    let retweeted = false;
    for (let page = 0; page < maxPages; page++) {
      const params: Record<string, string> = { tweetId };
      if (cursor) params.cursor = cursor;

      const payload = await this.getJson<{
        users?: Array<{ userName?: string; screen_name?: string }>;
        has_next_page?: boolean;
        next_cursor?: string;
        cursor?: string;
      }>('/twitter/tweet/retweeters', params);

      const root = payload as TwitterApiEnvelope<{
        users?: Array<{ userName?: string; screen_name?: string }>;
        has_next_page?: boolean;
        next_cursor?: string;
        cursor?: string;
      }>;
      const data = root.data ?? payload;
      const users = data.users ?? [];
      for (const u of users) {
        const handle = normalizeTwitterUsername(
          u.userName ?? u.screen_name ?? '',
        );
        if (handle === needle) {
          retweeted = true;
          break;
        }
      }
      if (retweeted) break;

      const hasNext = data.has_next_page === true;
      const next = data.next_cursor ?? data.cursor ?? '';
      if (!hasNext || !next || next === cursor) break;
      cursor = next;
    }

    // Cache hasil akhir (positif 6 jam / negatif 90 dtk).
    await this.cache.setRetweet(needle, tweetId, retweeted);
    return retweeted;
  }

  async verifyFollowTask(
    userUsername: string,
    taskTarget: string | null,
  ): Promise<void> {
    const target = parseTwitterFollowTarget(taskTarget);
    if (!target) {
      throw new BadRequestException(
        'This follow task has an invalid target account.',
      );
    }
    const following = await this.userFollowsTarget(userUsername, target);
    if (!following) {
      throw new BadRequestException(
        `Follow @${target} on X first, then tap Verify again.`,
      );
    }
  }

  async verifyRetweetTask(
    userUsername: string,
    taskTarget: string | null,
  ): Promise<void> {
    const tweetId = parseTweetIdFromTarget(taskTarget);
    if (!tweetId) {
      throw new BadRequestException(
        'This retweet task needs a post URL (e.g. https://x.com/user/status/1234567890), not a profile link.',
      );
    }
    const retweeted = await this.userRetweetedTweet(userUsername, tweetId);
    if (!retweeted) {
      throw new BadRequestException(
        'Retweet the required post on X first, then tap Verify again.',
      );
    }
  }
}
