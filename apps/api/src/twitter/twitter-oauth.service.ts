import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import { TwitterCacheService } from './twitter-cache.service';

/**
 * Hasil verifikasi OAuth Twitter (PKCE flow manual).
 * Data ini dijamin asli karena ditarik langsung dari Twitter API v2
 * setelah user authorize aplikasi kita.
 */
export interface VerifiedXAccount {
  /** Twitter user ID numerik permanen. */
  twitterUserId: string;
  /** Handle X lowercase tanpa @. */
  twitterUsername: string;
  /** Display name di profil X (nullable). */
  displayName: string | null;
}

/** Hasil getAuthorizationUrl — frontend pakai ini untuk redirect user. */
export interface TwitterAuthUrlResult {
  /** URL lengkap di twitter.com untuk user authorize. */
  authorizationUrl: string;
  /** State acak (juga disimpan di Redis untuk verifikasi callback). */
  state: string;
}

/**
 * Response dari Twitter OAuth 2.0 token endpoint.
 */
interface TwitterTokenResponse {
  token_type?: string;
  expires_in?: number;
  access_token?: string;
  scope?: string;
  refresh_token?: string;
}

/**
 * Response dari Twitter API v2 /2/users/me.
 */
interface TwitterMeResponse {
  data?: {
    id: string;
    name: string;
    username: string;
  };
}

/**
 * Service untuk OAuth 2.0 PKCE flow Twitter — IMPLEMENTASI MANUAL.
 *
 * Kenapa manual (bukan pakai Supabase Auth)?
 *   Supabase Auth memaksa scope `users.email` ke Twitter. Twitter Free Tier
 *   menolak memberikan email → Supabase error "getting user profile". Karena
 *   Supabase tidak configurable soal ini, kita implementasi OAuth sendiri
 *   dengan scope yang kita kontrol (tanpa email).
 *
 * Flow PKCE (Proof Key for Code Exchange):
 *   1. Backend generate code_verifier (random 43-128 char) + code_challenge
 *      (S256 hash dari verifier).
 *   2. Backend simpan { userId, codeVerifier } di Redis, key=state, TTL 10m.
 *   3. Frontend redirect user ke twitter.com/i/oauth2/authorize dengan
 *      code_challenge + state.
 *   4. User login & authorize di Twitter.
 *   5. Twitter redirect ke /callback?code=...&state=...
 *   6. Backend verify state ada di Redis, ambil codeVerifier.
 *   7. Backend POST ke api.twitter.com/2/oauth2/token dengan code + verifier
 *      → dapat access_token (App-only tidak cukup; kita pakai user-context).
 *   8. Backend GET api.twitter.com/2/users/me dengan Bearer access_token
 *      → dapat { id, name, username }.
 *
 * Scope: tweet.read users.read offline.access (TIDAK ADA users.email).
 *
 * Docs:
 *   https://developer.twitter.com/en/docs/authentication/oauth-2-0/authorization-code
 *   https://developer.twitter.com/en/docs/authentication/oauth-2-0/user-access-token
 */
@Injectable()
export class TwitterOAuthService {
  private readonly logger = new Logger(TwitterOAuthService.name);

  private readonly authorizeUrl = 'https://twitter.com/i/oauth2/authorize';
  private readonly tokenUrl = 'https://api.twitter.com/2/oauth2/token';
  private readonly meUrl = 'https://api.twitter.com/2/users/me';

  /** Scope yang diminta — PENTING: tanpa users.email. */
  private readonly scopes = ['tweet.read', 'users.read', 'offline.access'];

  constructor(
    private readonly config: ConfigService,
    private readonly cache: TwitterCacheService,
  ) {}

  /** True kalau env vars OAuth Twitter sudah dikonfigurasi. */
  isConfigured(): boolean {
    return Boolean(
      this.clientId() && this.clientSecret() && this.callbackUrl(),
    );
  }

  private clientId(): string {
    return this.config.get<string>('TWITTER_CLIENT_ID')?.trim() ?? '';
  }

  private clientSecret(): string {
    return this.config.get<string>('TWITTER_CLIENT_SECRET')?.trim() ?? '';
  }

  private callbackUrl(): string {
    return this.config.get<string>('TWITTER_CALLBACK_URL')?.trim() ?? '';
  }

  /**
   * Generate URL otorisasi Twitter + simpan state↔verifier di Redis.
   * Dipanggil saat user klik "Connect X" di Settings.
   *
   * @param userId ID user CanQuest yang memulai flow (di-bind ke state).
   */
  async getAuthorizationUrl(userId: string): Promise<TwitterAuthUrlResult> {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Twitter OAuth is not configured on this server (TWITTER_CLIENT_ID / SECRET / CALLBACK_URL).',
      );
    }

    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.computeCodeChallenge(codeVerifier);
    const state = this.generateState();

    // Simpan state → { userId, codeVerifier } di Redis (TTL 10 menit).
    const saved = await this.cache.setOAuthState(state, {
      userId,
      codeVerifier,
    });
    if (!saved) {
      // Redis wajib untuk PKCE (tanpa Redis, codeVerifier hilang → exchange gagal).
      this.logger.warn(
        'Failed to persist OAuth state to Redis. Is Redis up? Aborting getAuthorizationUrl.',
      );
      throw new BadRequestException(
        'Could not start OAuth flow (cache unavailable). Please try again in a moment.',
      );
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId(),
      redirect_uri: this.callbackUrl(),
      scope: this.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      authorizationUrl: `${this.authorizeUrl}?${params.toString()}`,
      state,
    };
  }

  /**
   * Consume state dari Redis (one-shot). Return { userId, codeVerifier }
   * kalau state valid & ada, null kalau tidak (misal callback pakai state asing,
   * atau state sudah expired).
   */
  async consumeState(state: string): Promise<{
    userId: string;
    codeVerifier: string;
  } | null> {
    return this.cache.consumeOAuthState(state);
  }

  /**
   * Tukar authorization code dengan access token (PKCE).
   * Return access_token string.
   */
  async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
  ): Promise<string> {
    if (!this.isConfigured()) {
      throw new UnauthorizedException(
        'Twitter OAuth is not configured on this server.',
      );
    }

    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: this.clientId(),
      redirect_uri: this.callbackUrl(),
      code_verifier: codeVerifier,
    });

    // Twitter OAuth 2.0 butuh Basic Auth: client_id:client_secret base64.
    const basicAuth = Buffer.from(
      `${this.clientId()}:${this.clientSecret()}`,
    ).toString('base64');

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(20_000),
    });

    const data = (await res.json().catch(() => ({}))) as TwitterTokenResponse &
      { error?: string; error_description?: string };

    if (!res.ok || !data.access_token) {
      const msg =
        data.error_description?.trim() ||
        data.error?.trim() ||
        `Twitter token exchange failed (HTTP ${res.status})`;
      this.logger.warn(`Twitter token exchange failed: ${msg}`);
      throw new UnauthorizedException(
        `Could not complete X authorization: ${msg}`,
      );
    }

    return data.access_token;
  }

  /**
   * Ambil profil user X (id, name, username) dengan access token.
   * Tidak minta email — sesuai scope yang kita request.
   */
  async getTwitterUser(accessToken: string): Promise<VerifiedXAccount> {
    const params = new URLSearchParams({
      'user.fields': 'id,name,username',
    });

    const res = await fetch(`${this.meUrl}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(20_000),
    });

    const data = (await res.json().catch(() => ({}))) as TwitterMeResponse & {
      error?: string;
      'error_description'?: string;
      detail?: string;
      title?: string;
    };

    if (!res.ok || !data.data) {
      const msg =
        data.title?.trim() ||
        data.detail?.trim() ||
        data.error?.trim() ||
        `Twitter /users/me failed (HTTP ${res.status})`;
      this.logger.warn(`Twitter get user failed: ${msg}`);
      throw new UnauthorizedException(
        `Could not retrieve your X profile: ${msg}`,
      );
    }

    const handle = data.data.username.trim().replace(/^@/, '').toLowerCase();
    if (!handle || !data.data.id) {
      throw new UnauthorizedException(
        'Twitter returned incomplete profile data.',
      );
    }

    return {
      twitterUserId: String(data.data.id),
      twitterUsername: handle,
      displayName: data.data.name?.trim() || null,
    };
  }

  // ── Crypto helpers (PKCE) ─────────────────────────────────────

  /**
   * Generate code_verifier — random string 43-128 char URL-safe.
   * Pakai 32 byte random → base64url = 43 char (minimum valid).
   */
  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Compute code_challenge = base64url(SHA256(code_verifier)).
   * Method: S256.
   */
  private computeCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  /** Generate state acak (16 byte → base64url = 22 char). */
  private generateState(): string {
    return randomBytes(16).toString('base64url');
  }
}
