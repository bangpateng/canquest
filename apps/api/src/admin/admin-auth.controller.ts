import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';

import { AdminLoginDto } from './dto/admin-login.dto';

type AdminReqUser = { adminPanel: true; email: string };
type AdminAuthedReq = Request & { user: AdminReqUser };

/**
 * Constant-time string comparison to avoid leaking the length/prefix of the
 * expected secret via response timing. Both inputs are padded to equal length.
 */
function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB);
}

@Controller('admin/auth')
export class AdminAuthController {
  private readonly logger = new Logger(AdminAuthController.name);

  /** In-process brute-force lockout: 5 failures in 15 min → block 15 min. */
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
  private static readonly THROTTLE_WINDOW_MS = 15 * 60 * 1000;
  private readonly failedAttempts = new Map<string, { count: number; firstAt: number }>();
  private readonly lockedUntil = new Map<string, number>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Strict throttle on admin login: 5 attempts / 15 min per IP (in addition to
   * the in-process lockout below). Mounted as a decorator so the dedicated
   * `auth`-style tier applies here — the global default tier is much looser.
   */
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(
    @Req() req: Request,
    @Body() login: AdminLoginDto,
  ): Promise<{ accessToken: string }> {
    const clientKey = this.clientFingerprint(req);

    // ── In-process account lockout after repeated failures ─────────────────
    const lockedUntil = this.lockedUntil.get(clientKey) ?? 0;
    if (lockedUntil > Date.now()) {
      const remainingMs = lockedUntil - Date.now();
      const minutes = Math.ceil(remainingMs / 60_000);
      this.logger.warn(
        `Admin login blocked (lockout) key=${clientKey} — ${minutes}m remaining`,
      );
      throw new ServiceUnavailableException(
        `Too many failed attempts. Try again in ~${minutes} minute(s).`,
      );
    }

    const norm = (s: string | undefined) =>
      s === undefined ? '' : s.replace(/^\ufeff/, '').trim();

    // Config often misses vars when workspaces start Nest from repo root; loadEnv order + fallback.
    const expectedEmail =
      norm(this.config.get<string>('ADMIN_PANEL_EMAIL'))?.toLowerCase() ||
      norm(process.env.ADMIN_PANEL_EMAIL)?.toLowerCase();

    const expectedPass =
      norm(this.config.get<string>('ADMIN_PANEL_PASSWORD')) ||
      norm(process.env.ADMIN_PANEL_PASSWORD);

    if (!expectedEmail || !expectedPass) {
      throw new InternalServerErrorException(
        [
          'Admin panel credentials are not configured (ADMIN_PANEL_EMAIL / ADMIN_PANEL_PASSWORD).',
          'Set them in apps/api/.env or ensure no empty OS-level env duplicates those names, then restart the API.',
        ].join(' '),
      );
    }

    const email = login.email.trim().toLowerCase();
    // Constant-time comparison on BOTH fields so neither email nor password
    // leaks through response timing.
    const emailOk = safeEqualString(email, expectedEmail);
    const passOk = safeEqualString(login.password ?? '', expectedPass);
    if (!emailOk || !passOk) {
      this.registerFailedAttempt(clientKey);
      this.logger.warn(
        `Admin login failed key=${clientKey} emailOk=${emailOk} passOk=${passOk}`,
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    // Successful login → clear failure counters for this client.
    this.failedAttempts.delete(clientKey);
    this.lockedUntil.delete(clientKey);

    const accessToken = await this.jwt.signAsync(
      { scope: 'admin-panel', email },
      {
        subject: 'admin-panel',
        expiresIn: '8h',
      },
    );
    return { accessToken };
  }

  /** Stable client fingerprint combining IP + forwarded-for (best-effort). */
  private clientFingerprint(req: Request): string {
    const xff = req.headers['x-forwarded-for'];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;
    return `${xffStr?.split(',')[0]?.trim() ?? ''}|${req.ip ?? ''}`;
  }

  /** Track consecutive failures and trigger lockout when the threshold is hit. */
  private registerFailedAttempt(key: string): void {
    const now = Date.now();
    const windowStart = now - AdminAuthController.THROTTLE_WINDOW_MS;
    const entry = this.failedAttempts.get(key);
    if (!entry || entry.firstAt < windowStart) {
      this.failedAttempts.set(key, { count: 1, firstAt: now });
      return;
    }
    entry.count += 1;
    if (entry.count >= AdminAuthController.MAX_FAILED_ATTEMPTS) {
      this.lockedUntil.set(key, now + AdminAuthController.LOCKOUT_WINDOW_MS);
      this.logger.error(
        `Admin login lockout triggered key=${key} after ${entry.count} failures`,
      );
      // Reset the counter so a new window starts after the lockout expires.
      this.failedAttempts.delete(key);
    }
  }

  /** Check whether the Bearer token is a valid panel session. */
  @Get('me')
  @UseGuards(AuthGuard('admin-jwt'))
  me(@Req() req: AdminAuthedReq) {
    return { ok: true, email: req.user.email };
  }
}
