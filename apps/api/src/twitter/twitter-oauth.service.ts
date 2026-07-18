import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Hasil verifikasi OAuth Twitter dari Supabase Auth.
 * Data ini dijamin asli karena ditarik langsung dari session Supabase
 * yang dibuat setelah user authorize aplikasi di Twitter.
 */
export interface VerifiedXAccount {
  /** Twitter user ID numerik permanen (dari app_metadata.provider_id). */
  twitterUserId: string;
  /** Handle X lowercase tanpa @ (dari user_metadata.user_name / username). */
  twitterUsername: string;
  /** Display name di profil X (nullable). */
  displayName: string | null;
  /** URL avatar X (pbs.twimg.com, nullable). */
  avatarUrl: string | null;
}

/**
 * Service untuk verifikasi token OAuth Twitter yang diterbitkan Supabase Auth.
 *
 * Supabase Auth Twitter provider: user klik "Connect X" di frontend →
 * `supabase.auth.signInWithOAuth({ provider: 'twitter' })` → user authorize di
 * Twitter → Supabase buat session & minta access_token → frontend kirim token
 * itu ke backend → service ini verify via `supabase.auth.getUser(token)` untuk
 * dapat user identity yang sudah diverifikasi pemiliknya.
 *
 * Ini menggantikan alur input teks manual (di mana user bisa masukin username
 * siapapun selama belum dipakai user lain).
 */
@Injectable()
export class TwitterOAuthService {
  private readonly logger = new Logger(TwitterOAuthService.name);
  private readonly supabase: SupabaseClient | null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL')?.trim();
    const anonKey = this.config.get<string>('SUPABASE_ANON_KEY')?.trim();
    if (url && anonKey) {
      this.supabase = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      this.logger.log('Supabase OAuth client initialised.');
    } else {
      this.supabase = null;
      this.logger.warn(
        'SUPABASE_URL / SUPABASE_ANON_KEY not set — Twitter OAuth flow disabled. ' +
          'Falls back to legacy text-input connect (will fail if env SUPABASE_* is required).',
      );
    }
  }

  /** True kalau Supabase Auth Twitter provider sudah dikonfigurasi di server. */
  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('SUPABASE_URL')?.trim() &&
        this.config.get<string>('SUPABASE_ANON_KEY')?.trim(),
    );
  }

  /**
   * Verifikasi access_token OAuth dari Supabase, return data user X terverifikasi.
   * Throws UnauthorizedException kalau token invalid/expired atau bukan provider Twitter.
   */
  async verifyOAuthToken(accessToken: string): Promise<VerifiedXAccount> {
    if (!this.supabase) {
      throw new UnauthorizedException(
        'Supabase OAuth is not configured on this server (SUPABASE_URL / SUPABASE_ANON_KEY missing).',
      );
    }
    const token = accessToken?.trim();
    if (!token) {
      throw new UnauthorizedException('Missing OAuth access token.');
    }

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data?.user) {
      this.logger.warn(
        `Supabase getUser failed: ${error?.message ?? 'no user returned'}`,
      );
      throw new UnauthorizedException(
        'Invalid or expired OAuth session. Please retry Connect X.',
      );
    }

    const user = data.user;
    const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
    const userMeta = (user.user_metadata ?? {}) as Record<string, unknown>;

    // Pastikan provider = twitter atau x (Supabase bisa "twitter"; "x" sebagai alias future-proof).
    const provider = toMetaString(appMeta.provider);
    if (provider !== 'twitter' && provider !== 'x') {
      throw new UnauthorizedException(
        `OAuth provider is not Twitter/X (got: ${provider || 'unknown'}).`,
      );
    }

    // provider_id = Twitter user ID numerik permanen (paling reliable).
    const twitterUserId = (
      toMetaString(appMeta.provider_id) ||
      toMetaString(userMeta.id) ||
      toMetaString(userMeta.user_id) ||
      ''
    ).trim();

    // Handle: Supabase biasanya taruh di user_name (legacy Twitter) atau username.
    const usernameRaw = (
      toMetaString(userMeta.user_name) ||
      toMetaString(userMeta.username) ||
      toMetaString(userMeta.full_name) ||
      ''
    )
      .trim()
      .replace(/^@/, '')
      .toLowerCase();

    if (!twitterUserId || !usernameRaw) {
      this.logger.warn(
        `OAuth user ${user.id} missing twitterUserId or username. app_meta=${JSON.stringify(appMeta)} user_meta keys=${Object.keys(userMeta).join(',')}`,
      );
      throw new UnauthorizedException(
        'Could not extract Twitter identity from OAuth session.',
      );
    }

    return {
      twitterUserId,
      twitterUsername: usernameRaw,
      displayName: toMetaString(userMeta.name) || null,
      avatarUrl:
        toMetaString(userMeta.avatar_url) ||
        toMetaString(userMeta.picture) ||
        null,
    };
  }
}

/** Konversi nilai metadata ke string aman (string | number → string, lainnya → ''). */
function toMetaString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}
