import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { TwitterApiService } from './twitter-api.service';
import { TwitterOAuthService } from './twitter-oauth.service';
import { ConnectTwitterOAuthDto } from './dto/connect-twitter-oauth.dto';
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
    const raw = this.config.get<string>('TWITTER_OAUTH_MIGRATION_DEADLINE')?.trim();
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
      // BARU — info OAuth untuk UI.
      oauthVerified: Boolean(user?.twitterOAuthVerified),
      oauthConfigured: this.twitterOAuth.isConfigured(),
      oauthMigrationDeadline: deadline ? deadline.toISOString() : null,
    };
  }

  /**
   * Connect X via OAuth (Supabase Auth Twitter provider).
   *
   * Body: { oauthAccessToken: string }  (BUKAN { username } lagi)
   * Token ditarik dari session Supabase yang dibuat setelah user authorize di X.
   *
   * 3 mode (tergantung state user):
   *   A. User BARU (twitterUsername NULL): link fresh, langsung verified.
   *   B. User LAMA belum OAuth (twitterUsername set, oauthVerified=false):
   *      - cocok handle → migrasi sukses (oauthVerified=true).
   *      - tidak cocok → tolak (anti-swapping).
   *   C. User LAMA sudah OAuth (oauthVerified=true): permanent lock.
   */
  @Post('connect')
  async connect(
    @Req() req: AuthedReq,
    @Body() body: ConnectTwitterOAuthDto,
  ) {
    if (!this.twitterOAuth.isConfigured()) {
      throw new BadRequestException(
        'Twitter OAuth (Supabase) is not configured on this server. ' +
          'Set SUPABASE_URL and SUPABASE_ANON_KEY.',
      );
    }
    if (!this.twitterApi.isConfigured()) {
      throw new BadRequestException(
        'Twitter verification (twitterapi.io) is not configured on this server.',
      );
    }

    // STEP 1: Verifikasi token OAuth dari Supabase → identitas X terverifikasi pemiliknya.
    const verified = await this.twitterOAuth.verifyOAuthToken(
      body.oauthAccessToken,
    );
    const oauthHandle = normalizeTwitterUsername(verified.twitterUsername);
    if (!oauthHandle) {
      throw new BadRequestException(
        'Resolved X handle from OAuth is invalid. Please retry Connect X.',
      );
    }

    // STEP 2 (anti-sybil): pastikan twitterUserId dari OAuth belum dipakai user lain.
    const existingByUserId = await this.prisma.user.findFirst({
      where: {
        twitterUserId: verified.twitterUserId,
        NOT: { id: req.user.userId },
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
      where: { id: req.user.userId },
      select: {
        twitterUsername: true,
        twitterOAuthVerified: true,
      },
    });

    // MODE C: User sudah verified → permanent lock (tidak bisa gonta-ganti).
    if (currentUser?.twitterOAuthVerified) {
      throw new ConflictException(
        'This account is permanently linked to an X handle and cannot be changed. Contact support if you need help.',
      );
    }

    const isMigrationMode = Boolean(currentUser?.twitterUsername);

    // MODE B: User lama (text-input) — handle OAuth HARUS cocok dengan handle existing.
    if (isMigrationMode) {
      const existingHandle = normalizeTwitterUsername(
        currentUser!.twitterUsername ?? '',
      );
      if (existingHandle !== oauthHandle) {
        this.logger.warn(
          `User ${req.user.userId} tried to re-verify as @${oauthHandle} but is registered as @${existingHandle}.`,
        );
        throw new ConflictException(
          `Akun X yang Anda otorisasi (@${oauthHandle}) tidak cocok dengan username yang terdaftar sebelumnya (@${existingHandle}). Hubungi support jika butuh bantuan.`,
        );
      }
    }

    // STEP 3 (anti-bot umur akun): fetch created_at via twitterapi.io.
    let accountCreatedAt: Date | null = null;
    try {
      accountCreatedAt = await this.twitterApi.fetchAccountCreatedAt(oauthHandle);
    } catch (err) {
      // Fail-open kalau twitterapi.io error (token dibakar, API down). Log & lanjut.
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

    // STEP 4: fetch profile (avatar / displayName) supaya leaderboard tetap hydrated.
    const profile = await this.twitterApi.fetchUserProfile(oauthHandle);

    const now = new Date();
    await this.prisma.user.update({
      where: { id: req.user.userId },
      data: {
        twitterUsername: oauthHandle,
        twitterUserId: verified.twitterUserId,
        twitterAvatarUrl: profile.profileImageUrl ?? verified.avatarUrl,
        twitterConnectedAt: now,
        twitterOAuthVerified: true,
        twitterOAuthVerifiedAt: now,
        ...(accountCreatedAt
          ? { twitterAccountCreatedAt: accountCreatedAt }
          : {}),
        ...(profile.displayName || verified.displayName
          ? { displayName: profile.displayName ?? verified.displayName }
          : {}),
      },
    });

    // Referral completion gate — idempotent. Connect X adalah salah satu syarat.
    await this.referral.completeReferralForUser(req.user.userId);

    this.logger.log(
      `User ${req.user.userId} ${isMigrationMode ? 'migrated' : 'linked'} X as @${oauthHandle} (id=${verified.twitterUserId}).`,
    );

    return {
      ok: true,
      username: oauthHandle,
      avatarUrl: profile.profileImageUrl ?? verified.avatarUrl,
      connectedAt: now.toISOString(),
      oauthVerified: true,
      migrated: isMigrationMode,
    };
  }

  @Delete('disconnect')
  async disconnect(@Req() req: AuthedReq) {
    // LOCK PERMANEN: akun yang sudah terhubung tidak boleh dilepas.
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { twitterUsername: true },
    });
    if (user?.twitterUsername) {
      throw new BadRequestException(
        'Once an X account is linked, it cannot be disconnected. Contact support if you need help.',
      );
    }
    await this.prisma.user.update({
      where: { id: req.user.userId },
      data: {
        twitterUsername: null,
        twitterUserId: null,
        twitterAvatarUrl: null,
        twitterConnectedAt: null,
        twitterOAuthVerified: false,
        twitterOAuthVerifiedAt: null,
        twitterAccountCreatedAt: null,
      },
    });
    return { ok: true };
  }
}
