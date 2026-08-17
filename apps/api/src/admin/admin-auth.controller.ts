import {
  Body,
  Controller,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Secret, TOTP } from 'otpauth';

import { AdminLoginDto } from './dto/admin-login.dto';

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
  private readonly failedAttempts = new Map<
    string,
    { count: number; firstAt: number }
  >();
  private readonly lockedUntil = new Map<string, number>();
  private lastSweep = 0;

  /** Replay guard TOTP: kode yang sudah dipakai ditolak dalam 90 detik. */
  private readonly consumedTotpCodes = new Map<string, number>();
  private static readonly TOTP_REUSE_WINDOW_MS = 90_000;

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
    this.sweepIfNeeded();
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

    // SECURITY (H2): In production the admin password MUST be stored as a bcrypt
    // hash (ADMIN_PANEL_PASSWORD_HASH), never as plaintext. A plaintext password
    // in .env / backups is directly readable with no cracking. The plaintext
    // fallback (ADMIN_PANEL_PASSWORD) is allowed ONLY outside production for
    // local dev / demo scripts.
    const expectedHash =
      norm(this.config.get<string>('ADMIN_PANEL_PASSWORD_HASH')) ||
      norm(process.env.ADMIN_PANEL_PASSWORD_HASH);
    const isProduction =
      (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV) ===
      'production';
    const expectedPass = isProduction
      ? '' // never read plaintext in production
      : norm(this.config.get<string>('ADMIN_PANEL_PASSWORD')) ||
        norm(process.env.ADMIN_PANEL_PASSWORD);

    if (!expectedEmail || !expectedHash) {
      if (isProduction || !expectedPass) {
        throw new InternalServerErrorException(
          [
            'Admin panel credentials are not configured.',
            'Production requires ADMIN_PANEL_EMAIL + ADMIN_PANEL_PASSWORD_HASH (bcrypt).',
            "Generate a hash: node -e \"console.log(require('bcrypt').hashSync('YOUR_PASSWORD', 12))\"",
            'Set them in apps/api/.env or ensure no empty OS-level env duplicates those names, then restart the API.',
          ].join(' '),
        );
      }
    }

    const email = login.email.trim().toLowerCase();
    // Constant-time comparison on BOTH fields so neither email nor password
    // leaks through response timing.
    const emailOk = safeEqualString(email, expectedEmail);
    // bcrypt.verify is internally constant-time; legacy plaintext path (dev
    // only) uses safeEqualString to avoid timing leaks. Both are evaluated so
    // the failure path looks identical to a success-mismatch.
    const passOk = expectedHash
      ? await bcrypt.compare(login.password ?? '', expectedHash)
      : safeEqualString(login.password ?? '', expectedPass);
    if (!emailOk || !passOk) {
      this.registerFailedAttempt(clientKey);
      this.logger.warn(
        `Admin login failed key=${clientKey} emailOk=${emailOk} passOk=${passOk}`,
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    // ── Faktor kedua: kode TOTP dari authenticator ──────────────────────────
    try {
      this.verifyTotpOrThrow(login.totpCode, email, isProduction);
    } catch (err) {
      // Gagal kode dihitung sebagai percobaan gagal (ikut lockout); error
      // konfigurasi (5xx) tidak dihitung supaya salah setup tidak mengunci.
      if (err instanceof UnauthorizedException) {
        this.registerFailedAttempt(clientKey);
        this.logger.warn(`Admin login TOTP failed key=${clientKey}`);
      }
      throw err;
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

  /**
   * Verifikasi kode TOTP (6 digit, toleransi drift ±30 detik). Fail-closed di
   * production: tanpa ADMIN_TOTP_SECRET login admin ditolak sama sekali —
   * password bocor saja tidak cukup untuk masuk. Di luar production secret
   * boleh kosong (dev lokal tanpa authenticator). Kode yang sama tidak bisa
   * dipakai ulang dalam 90 detik (replay guard, in-process seperti lockout —
   * aman selama API single-instance).
   */
  private verifyTotpOrThrow(
    code: string | undefined,
    email: string,
    isProduction: boolean,
  ): void {
    const secretBase32 = (
      this.config.get<string>('ADMIN_TOTP_SECRET') ??
      process.env.ADMIN_TOTP_SECRET ??
      ''
    )
      .trim()
      .replace(/\s+/g, '');

    if (!secretBase32) {
      if (isProduction) {
        throw new InternalServerErrorException(
          [
            'Admin 2FA is mandatory in production: ADMIN_TOTP_SECRET is not set.',
            'Generate: node scripts/gen-admin-totp.cjs <ADMIN_PANEL_EMAIL>',
            'Scan the otpauth URI with an authenticator app, set ADMIN_TOTP_SECRET in apps/api/.env, then restart the API.',
          ].join(' '),
        );
      }
      this.logger.warn(
        'ADMIN_TOTP_SECRET not set — admin login proceeds WITHOUT 2FA (non-production only)',
      );
      return;
    }

    const normalized = (code ?? '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalized)) {
      throw new UnauthorizedException('Invalid authenticator code');
    }

    const consumedUntil = this.consumedTotpCodes.get(normalized) ?? 0;
    if (consumedUntil > Date.now()) {
      this.logger.warn('Admin TOTP code replay rejected');
      throw new UnauthorizedException('Invalid authenticator code');
    }

    let totp: TOTP;
    try {
      totp = new TOTP({
        issuer: 'CanQuest Admin',
        label: email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secretBase32),
      });
    } catch (err) {
      this.logger.error(`ADMIN_TOTP_SECRET is not valid base32: ${String(err)}`);
      throw new InternalServerErrorException(
        'Admin 2FA secret is misconfigured (invalid base32).',
      );
    }

    // window: 1 → terima kode step sebelumnya/berikutnya (drift clock ±30s).
    if (totp.validate({ token: normalized, window: 1 }) === null) {
      throw new UnauthorizedException('Invalid authenticator code');
    }

    this.consumedTotpCodes.set(
      normalized,
      Date.now() + AdminAuthController.TOTP_REUSE_WINDOW_MS,
    );
  }

  /** Stable client fingerprint. req.ip sudah di-resolve via Express
   *  `trust proxy` dan TIDAK bisa dipalsukan. JANGAN campur X-Forwarded-For
   *  mentah — elemen paling kirinya dikontrol penyerang dan akan membuat
   *  kunci lockout berganti tiap request (lockout jadi bisa dilewati). */
  private clientFingerprint(req: Request): string {
    return req.ip ?? 'unknown';
  }

  /** Buang entri kedaluwarsa secara berkala (maksimal sekali per menit) agar
   *  failedAttempts/lockedUntil tidak tumbuh tanpa batas dari IP sekali jalan. */
  private sweepIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.failedAttempts) {
      if (v.firstAt < now - AdminAuthController.THROTTLE_WINDOW_MS) {
        this.failedAttempts.delete(k);
      }
    }
    for (const [k, until] of this.lockedUntil) {
      if (until <= now) this.lockedUntil.delete(k);
    }
    for (const [code, until] of this.consumedTotpCodes) {
      if (until <= now) this.consumedTotpCodes.delete(code);
    }
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
}
