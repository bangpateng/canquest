import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { TwitterApiService } from './twitter-api.service';
import {
  TwitterOAuthService,
  type VerifiedXAccount,
} from './twitter-oauth.service';
import { normalizeTwitterUsername } from './twitter-target.util';
import { ReferralService } from '../users/referral.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('twitter')
@UseGuards(AuthGuard('jwt'))
export class TwitterController {
  private readonly logger = new Logger(TwitterController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly twitterApi: TwitterApiService,
    private readonly twitterOAuth: TwitterOAuthService,
    private readonly referral: ReferralService,
    private readonly config: ConfigService,
  ) {}

  private async backfillAvatarIfMissing(
    userId: string,
    twitterUsername: string,
  ) {
    if (!this.twitterApi.isConfigured()) return null;
    try {
      const profile = await this.twitterApi.fetchUserProfile(twitterUsername);
      if (!profile.profileImageUrl) return null;
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          twitterAvatarUrl: profile.profileImageUrl,
          ...(profile.userId ? { twitterUserId: profile.userId } : {}),
        },
      });
      return profile.profileImageUrl;
    } catch {
      return null;
    }
  }

  /** Threshold umur minimum akun X (hari) untuk anti-bot. Default 30 hari. */
  private minAccountAgeDays(): number {
    const raw = this.config.get<string>('TWITTER_MIN_ACCOUNT_AGE_DAYS');
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 30;
    return Math.floor(n);
  }

  /** Deadline migrasi (ISO date). Setelah ini, task X di-block untuk user !oauthVerified. */
  private migrationDeadline(): Date | null {
    const raw = this.config
      .get<string>('TWITTER_OAUTH_MIGRATION_DEADLINE')
      ?.trim();
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  @Get('status')
  async status(@Req() req: AuthedReq) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        twitterUsername: true,
        twitterConnectedAt: true,
        twitterUserId: true,
        twitterAvatarUrl: true,
        twitterOAuthVerified: true,
      },
    });

    let twitterAvatarUrl = user?.twitterAvatarUrl ?? null;
    if (user?.twitterUsername && !twitterAvatarUrl) {
      twitterAvatarUrl = await this.backfillAvatarIfMissing(
        req.user.userId,
        user.twitterUsername,
      );
    }

    const deadline = this.migrationDeadline();
    return {
      connected: Boolean(user?.twitterUsername),
      username: user?.twitterUsername ?? null,
      connectedAt: user?.twitterConnectedAt?.toISOString() ?? null,
      avatarUrl: twitterAvatarUrl,
      apiConfigured: this.twitterApi.isConfigured(),
      // OAuth info untuk UI.
      oauthVerified: Boolean(user?.twitterOAuthVerified),
      oauthConfigured: this.twitterOAuth.isConfigured(),
      oauthMigrationDeadline: deadline ? deadline.toISOString() : null,
    };
  }

  /**
   * Mulai OAuth flow — return URL otorisasi Twitter.
   *
   * Frontend call ini saat user klik "Connect X", lalu redirect browser ke
   * URL yang dikembalikan. State + codeVerifier disimpan di Redis oleh service.
   */
  @Get('auth-url')
  async getAuthUrl(@Req() req: AuthedReq) {
    if (!this.twitterOAuth.isConfigured()) {
      throw new BadRequestException(
        'Twitter OAuth is not configured on this server. Set TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, and TWITTER_CALLBACK_URL.',
      );
    }
    const result = await this.twitterOAuth.getAuthorizationUrl(req.user.userId);
    return {
      ok: true,
      authorizationUrl: result.authorizationUrl,
      state: result.state,
    };
  }

  /**
   * Callback OAuth — diterima dari Twitter setelah user authorize.
   *
   * Query: ?code=...&state=...
   *
   * Flow:
   *   1. Consume state dari Redis → dapat { userId, codeVerifier }.
   *      Kalau state invalid/expired → tolak (anti CSRF).
   *   2. Exchange code + codeVerifier → access_token (PKCE).
   *   3. GET /2/users/me dengan access_token → profil X terverifikasi.
   *   4. Anti-sybil: cek twitterUserId unik di DB.
   *   5. Permanent lock logic (user baru / migrasi cocok / migrasi beda).
   *   6. Anti-bot umur akun via twitterapi.io.
   *   7. Persist ke DB + complete referral.
   */
  @Get('callback')
  async handleCallback(
    @Req() req: AuthedReq,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
  ) {
    if (!this.twitterOAuth.isConfigured()) {
      throw new BadRequestException(
        'Twitter OAuth is not configured on this server.',
      );
    }
    if (!this.twitterApi.isConfigured()) {
      throw new BadRequestException(
        'Twitter verification (twitterapi.io) is not configured on this server.',
      );
    }
    if (!code || !state) {
      throw new BadRequestException(
        'Missing authorization code or state from Twitter.',
      );
    }

    // STEP 1: Consume state (one-shot). HARUS match userId yang login.
    const statePayload = await this.twitterOAuth.consumeState(state);
    if (!statePayload) {
      throw new BadRequestException(
        'OAuth state is invalid or expired. Please retry Connect X from Settings.',
      );
    }
    // Defense-in-depth: state harus dimulai oleh user yang sama yang login.
    // (Cegah user A mulai flow, lalu callback di-resolve ke sesi user B.)
    if (statePayload.userId !== req.user.userId) {
      this.logger.warn(
        `OAuth state user mismatch: state.userId=${statePayload.userId} but req.user.userId=${req.user.userId}.`,
      );
      throw new BadRequestException(
        'OAuth session mismatch. Please retry Connect X from Settings.',
      );
    }

    // STEP 2: Exchange code → access_token.
    const accessToken = await this.twitterOAuth.exchangeCodeForToken(
      code,
      statePayload.codeVerifier,
    );

    // STEP 3: Get verified profile.
    const verified = await this.twitterOAuth.getTwitterUser(accessToken);

    return this.persistVerifiedXAccount(req.user.userId, verified);
  }

  /**
   * Core logic persist — shared antar flow (sekarang cuma callback, tapi
   * dipisah supaya mudah dites / dipakai ulang kalau ada flow lain).
   */
  private async persistVerifiedXAccount(
    userId: string,
    verified: VerifiedXAccount,
  ) {
    const oauthHandle = normalizeTwitterUsername(verified.twitterUsername);
    if (!oauthHandle) {
      throw new BadRequestException(
        'Resolved X handle from OAuth is invalid. Please retry Connect X.',
      );
    }

    // ANTI-SYBIL: twitterUserId dari OAuth tidak boleh dipakai user lain.
    const existingByUserId = await this.prisma.user.findFirst({
      where: {
        twitterUserId: verified.twitterUserId,
        NOT: { id: userId },
      },
      select: { id: true },
    });
    if (existingByUserId) {
      throw new ConflictException(
        'This X account is already linked to another CanQuest user.',
      );
    }

    // Ambil user saat ini untuk evaluasi mode (baru / lama / lama-sudah-OAuth).
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        twitterUsername: true,
        twitterOAuthVerified: true,
      },
    });

    // MODE C: User sudah verified → permanent lock.
    if (currentUser?.twitterOAuthVerified) {
      throw new ConflictException(
        'This account is permanently linked to an X handle and cannot be changed. Contact support if you need help.',
      );
    }

    const isMigrationMode = Boolean(currentUser?.twitterUsername);

    // MODE B: User lama (text-input) — handle OAuth HARUS cocok.
    if (isMigrationMode) {
      const existingHandle = normalizeTwitterUsername(
        currentUser!.twitterUsername ?? '',
      );
      if (existingHandle !== oauthHandle) {
        this.logger.warn(
          `User ${userId} tried to re-verify as @${oauthHandle} but is registered as @${existingHandle}.`,
        );
        throw new ConflictException(
          `The X account you authorized (@${oauthHandle}) does not match the username previously registered (@${existingHandle}). Please contact support if you need help.`,
        );
      }
    }

    // ANTI-BOT umur akun via twitterapi.io (fail-open kalau API error).
    let accountCreatedAt: Date | null = null;
    try {
      accountCreatedAt = await this.twitterApi.fetchAccountCreatedAt(oauthHandle);
    } catch (err) {
      this.logger.warn(
        `fetchAccountCreatedAt failed for @${oauthHandle}: ${(err as Error).message}. Skipping age check.`,
      );
    }
    if (accountCreatedAt) {
      const minDays = this.minAccountAgeDays();
      const ageMs = Date.now() - accountCreatedAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < minDays) {
        throw new BadRequestException(
          `Your X account is too new (created ${Math.floor(ageDays)} days ago). ` +
            `Please try again after the account is at least ${minDays} days old.`,
        );
      }
    }

    // Fetch profile via twitterapi.io (avatar / displayName).
    const profile = await this.twitterApi.fetchUserProfile(oauthHandle);

    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twitterUsername: oauthHandle,
        twitterUserId: verified.twitterUserId,
        twitterAvatarUrl: profile.profileImageUrl,
        twitterConnectedAt: now,
        twitterOAuthVerified: true,
        twitterOAuthVerifiedAt: now,
        ...(accountCreatedAt
          ? { twitterAccountCreatedAt: accountCreatedAt }
          : {}),
        ...(profile.displayName
          ? { displayName: profile.displayName }
          : {}),
      },
    });

    // Referral completion gate — idempotent.
    await this.referral.completeReferralForUser(userId);

    this.logger.log(
      `User ${userId} ${isMigrationMode ? 'migrated' : 'linked'} X as @${oauthHandle} (id=${verified.twitterUserId}).`,
    );

    return {
      ok: true,
      username: oauthHandle,
      avatarUrl: profile.profileImageUrl,
      connectedAt: now.toISOString(),
      oauthVerified: true,
      migrated: isMigrationMode,
    };
  }
}
