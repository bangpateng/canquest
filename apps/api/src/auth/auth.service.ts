import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralService } from '../users/referral.service';
import { UsersService } from '../users/users.service';
import { resolvePublicAvatarUrl } from '../users/user-avatar-url';
import {
  normalizeCantonPartyId,
  normalizeWalletUsername,
} from '../common/canton-party-id';
import { validateRegistrationEmail } from '../common/disposable-email';
import { ResendEmailService } from './resend-email.service';
import { OAuth2Client } from 'google-auth-library';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 2 * 60 * 1000;
/// After this many wrong attempts the pending OTP is voided and the user must request a new code.
const MAX_OTP_ATTEMPTS = 5;

// Password reset (6-digit code) — separate from email OTP.
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly referral: ReferralService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly resend: ResendEmailService,
    /**
     * Lazy-init supaya dev lokal tanpa GOOGLE_CLIENT_ID tetap boot.
     * Di production, GOOGLE_CLIENT_ID wajib diset sebelum /auth/google dipanggil.
     */
  ) {
    this.googleClient = new OAuth2Client();
  }

  private readonly googleClient: OAuth2Client;

  async register(dto: {
    email: string;
    password: string;
    referralCode?: string;
  }) {
    if (process.env.AUTH_REGISTER_ENABLED === 'false') {
      throw new BadRequestException('Registration is currently disabled');
    }
    const email = dto.email.trim().toLowerCase();

    // Validasi email registrasi: blok disposable + batasi ke allowlist webmail
    // (anti-sybil referral). Pakai helper terpusat supaya pesan konsisten.
    const emailCheck = validateRegistrationEmail(email);
    if (!emailCheck.ok) {
      throw new BadRequestException(emailCheck.message);
    }

    const existing = await this.users.findByEmail(email);
    if (existing?.emailVerified) {
      throw new ConflictException('Email already registered');
    }

    const referredById = await this.resolveReferralForEmail(
      email,
      dto.referralCode,
    );
    const skipOtp = process.env.AUTH_REGISTER_SKIP_OTP === 'true';

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    if (existing && !existing.emailVerified) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: existing.id },
      });
      await this.users.resumeUnverifiedRegistration(
        existing.id,
        passwordHash,
        referredById,
      );

      if (skipOtp) {
        await this.users.setVerified(existing.id);
        await this.referral.completeReferralForUser(existing.id);
        return this.issueTokens(existing.id, existing.email);
      }

      const { devOtp } = await this.issueOtpForUser(existing.id, email);
      return {
        userId: existing.id,
        message: 'Verification code sent. Enter the code from your email.',
        devOtp,
      };
    }

    const referralCode = await this.referral.generateUniqueReferralCode();
    const localPart = email.split('@')[0] ?? 'User';
    const displayName =
      localPart.charAt(0).toUpperCase() +
      localPart.slice(1, 80).replace(/[.+]/g, ' ');

    const user = await this.users.create({
      email,
      passwordHash,
      referredById,
      referralCode,
      displayName,
      emailVerified: skipOtp,
    });

    if (skipOtp) {
      await this.referral.completeReferralForUser(user.id);
      return this.issueTokens(user.id, user.email);
    }

    const { devOtp } = await this.issueOtpForUser(user.id, email);
    return {
      userId: user.id,
      message: 'Registration started. Verify the code sent to your email.',
      devOtp,
    };
  }

  // ── Login ────────────────────────────────────────────────────────────────

  /**
   * Login via password lokal (bcrypt + JWT HS256).
   */
  async login(dto: { email: string; password: string }) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Account status gate — checked AFTER password compare so a banned/suspended
    // status is never leaked to password guessers.
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException(
        user.status === 'BANNED'
          ? 'This account has been banned.'
          : 'This account is suspended.',
      );
    }

    if (!user.emailVerified) {
      if (process.env.AUTH_REGISTER_SKIP_OTP === 'true') {
        await this.users.setVerified(user.id);
        await this.referral.completeReferralForUser(user.id);
        return this.issueTokens(user.id, user.email);
      }
      const { devOtp } = await this.issueOtpForUser(user.id, email);
      return {
        needsVerification: true,
        userId: user.id,
        message:
          'Email not verified yet. A new verification code was sent to your inbox.',
        devOtp,
      };
    }

    return this.issueTokens(user.id, user.email);
  }

  // ── Google Login ─────────────────────────────────────────────────────────

  /**
   * Login / register via Google ID Token (One Tap / GIS).
   *
   * FLOW:
   *   1. Verify Google ID Token (signature + audience match GOOGLE_CLIENT_ID).
   *   2. Wajib `email_verified=true` di payload Google (anti spoof).
   *   3. Cari existing User by email:
   *        - KETEMU (ACTIVE) → link Account(provider='google', sub=google_sub), issue JWT.
   *        - KETEMU (BANNED/SUSPENDED) → tolak.
   *        - TIDAK KETEMU → buat User baru (Google-only, passwordHash='') + link Account.
   *
   * KEAMANAN:
   *   - Auto-link by email AMAN untuk Gmail (Google enforce uniqueness + phone verify).
   *   - `providerAccountId` = Google sub (stable, immutable) bukan email — supaya
   *     user ganti email Google pun link tetap valid next login.
   *   - Gmail existing yang sudah set password: Account di-link, password tetap utuh
   *     (fallback tetap jalan).
   *   - Google-only users (passwordHash='') TIDAK bisa login via password
   *     (bcrypt.compare('', storedHash) → false).
   */
  async loginWithGoogle(idToken: string) {
    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new UnauthorizedException('Google login is not configured');
    }

    let payload;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.logger.warn(`Google token verify failed: ${String(err)}`);
      throw new UnauthorizedException('Invalid Google token');
    }

    if (!payload?.email_verified || !payload.email || !payload.sub) {
      throw new UnauthorizedException('Invalid Google token payload');
    }

    const email = payload.email.toLowerCase();
    const googleSub = payload.sub;

    // Cari existing user by email.
    let user = await this.users.findByEmail(email);
    if (!user) {
      // Register baru (Google-only). passwordHash wajib non-null di schema → ''.
      // Login password akan bcrypt.compare('', '') → false → password fallback blocked.
      const referralCode = await this.referral.generateUniqueReferralCode();
      const localPart = email.split('@')[0] ?? 'User';
      const displayName =
        payload.name ??
        localPart.charAt(0).toUpperCase() +
          localPart.slice(1, 80).replace(/[.+]/g, ' ');

      user = await this.users.create({
        email,
        passwordHash: '',
        referralCode,
        displayName,
        // Google sudah verifikasi email — skip OTP register.
        emailVerified: true,
      });
      // Referral reward berlaku setelah user terdaftar (no referrer pada Google login).
      await this.referral.completeReferralForUser(user.id);
    } else if (user.status !== 'ACTIVE') {
      throw new ForbiddenException(
        user.status === 'BANNED'
          ? 'This account has been banned.'
          : 'This account is suspended.',
      );
    }

    // Link Google Account (idempotent — kalau sudah link, no-op).
    await this.prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: googleSub,
        },
      },
      create: {
        userId: user.id,
        provider: 'google',
        providerAccountId: googleSub,
        email,
      },
      update: {},
    });

    return this.issueTokens(user.id, user.email);
  }

  async verifyOtp(userId: string, code: string) {
    const user = await this.users.findById(userId);
    if (!user?.otpCodeHash || !user.otpExpiresAt) {
      throw new UnauthorizedException('No pending verification');
    }
    if (user.otpExpiresAt < new Date()) {
      throw new UnauthorizedException('OTP expired');
    }
    if ((user.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
      await this.users.clearOtp(userId);
      throw new UnauthorizedException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    const trimmed = code.trim();
    const candidate = this.hashOtp(userId, trimmed, 'register');
    // Fallback 1: pre-purpose hash format (no prefix) for OTPs issued before
    // Fase 1.5 deploy. OTPs only live ~15 min, so this can be removed after one
    // full deploy cycle.
    // Fallback 2: legacy sha256 (no salt) — even older format, same window.
    // TODO: remove both fallbacks after one deploy cycle.
    const prePurpose = createHmac('sha256', this.otpSecret())
      .update(`${userId}:${trimmed}`)
      .digest('hex');
    const legacy = createHash('sha256').update(trimmed).digest('hex');
    const matched =
      this.safeHexEqual(candidate, user.otpCodeHash) ||
      this.safeHexEqual(prePurpose, user.otpCodeHash) ||
      this.safeHexEqual(legacy, user.otpCodeHash);

    if (!matched) {
      await this.users.incrementOtpAttempts(userId);
      throw new UnauthorizedException('Invalid OTP');
    }

    await this.users.setVerified(userId); // nulls the OTP fields + resets attempts
    await this.referral.completeReferralForUser(userId);

    const fresh = await this.users.findById(userId);
    if (!fresh) throw new UnauthorizedException();
    return this.issueTokens(fresh.id, fresh.email);
  }

  // ── Wallet creation OTP (Fase 1.5.2) ─────────────────────────────────────
  //
  // Reuse field User.otpCodeHash/otpExpiresAt/otpAttempts yang sama seperti OTP
  // register, tapi dengan purpose='wallet' di HMAC prefix supaya OTP register
  // tidak bisa diverifikasi di flow wallet (dan sebaliknya).
  //
  // Karena user pasti sudah login (JWT) saat create wallet, OTP register dan
  // OTP wallet TIDAK pernah jalan paralel — aman reuse field yang sama.

  /**
   * Issue OTP 6 digit untuk konfirmasi pembuatan wallet. OTP dikirim via
   * ResendEmailService.sendWalletCreationOtp. TTL 15 menit, max 5 attempts
   * (sama seperti OTP register). Resend cooldown 2 menit.
   */
  async issueWalletCreationOtp(
    userId: string,
    email: string,
  ): Promise<{ otp: string; devOtp?: string }> {
    const user = await this.users.findById(userId);
    if (user?.otpExpiresAt) {
      const issuedAt = user.otpExpiresAt.getTime() - OTP_TTL_MS;
      if (Date.now() - issuedAt < OTP_RESEND_COOLDOWN_MS) {
        throw new BadRequestException(
          'Please wait 2 minutes before requesting another code.',
        );
      }
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpCodeHash = this.hashOtp(userId, otp, 'wallet');
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    await this.users.setOtpPending(userId, otpCodeHash, otpExpiresAt);

    try {
      await this.resend.sendWalletCreationOtp(email, otp);
    } catch (err) {
      this.logger.error(
        `Wallet-creation OTP email failed for ${email}: ${String(err)}`,
      );
      throw err;
    }

    return {
      otp,
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    };
  }

  /**
   * Verify OTP wallet creation (TANPA execute onboarding — controller yang
   * eksekusi onboarding setelah verify sukses, supaya auth.service tetap
   * single-responsibility). Throw kalau OTP invalid/expired/attempt-exhausted.
   *
   * @returns `{ ok: true }` kalau OTP valid. Field User.otpCodeHash di-clear.
   */
  async verifyWalletCreationOtp(
    userId: string,
    code: string,
  ): Promise<{ ok: true }> {
    const user = await this.users.findById(userId);
    if (!user?.otpCodeHash || !user.otpExpiresAt) {
      throw new UnauthorizedException('No pending wallet verification');
    }
    if (user.otpExpiresAt < new Date()) {
      throw new UnauthorizedException('OTP expired');
    }
    if ((user.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
      await this.users.clearOtp(userId);
      throw new UnauthorizedException(
        'Too many incorrect attempts. Please request a new code.',
      );
    }

    const candidate = this.hashOtp(userId, code.trim(), 'wallet');
    if (!this.safeHexEqual(candidate, user.otpCodeHash)) {
      await this.users.incrementOtpAttempts(userId);
      throw new UnauthorizedException('Invalid OTP');
    }

    // Sukses — clear OTP field. EmailVerified TIDAK di-toggle (sudah true dari
    // Google register atau OTP register awal). Onboarding di-handle controller.
    await this.users.clearOtp(userId);
    return { ok: true };
  }

  async refresh(rawRefreshToken: string) {
    const refreshTokenHash = createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: refreshTokenHash },
      include: { user: true },
    });
    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const u = row.user;
    if (!u.emailVerified) {
      throw new UnauthorizedException('Email not verified');
    }
    // Banned/suspended users cannot refresh — sessions die once their access
    // token (≤15 mnt) expires. (Instant wallet check = phase 2, not here.)
    if (u.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(u.id, u.email);
  }

  async getMe(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    // Net points = earnPoints - earn entry cost spent (satu sumber kebenaran)
    const earnPoints = await this.users.getNetPoints(userId);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      username: normalizeWalletUsername(user.username) ?? user.username,
      cantonPartyId:
        normalizeCantonPartyId(user.cantonPartyId) ?? user.cantonPartyId,
      twitterUsername: user.twitterUsername,
      twitterConnectedAt: user.twitterConnectedAt?.toISOString() ?? null,
      earnPoints,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      avatarUrl: resolvePublicAvatarUrl(user),
    };
  }

  /**
   * Issue token SSE ephemeral (60 detik) untuk seorang user.
   *
   * Token ini dipakai frontend untuk connect ke /api/realtime/stream?token=...
   * Kenapa ephemeral terpisah, bukan pakai access token utama?
   *  - Access token utama (HS256 15 menit) di httpOnly cookie → tidak bisa dibaca
   *    JS client → tidak bisa dikirim via EventSource biasa.
   *  - Token SSE di-query-param bisa muncul di log → dibuat pendek (60s) + ditandai
   *    `kind: 'sse'` supaya guard SSE hanya terima token jenis ini.
   *
   * Dipanggil dari controller yang sudah dilindungi AuthGuard('jwt') → userId
   * sudah terverifikasi.
   *
   * Token SSE TETAP pakai HS256 + JWT_ACCESS_SECRET, karena token ini di-mint &
   * di-verify internal Nest (tidak keluar ke client selain via query param SSE).
   */
  async issueSseToken(userId: string): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = 60; // detik
    const token = await this.jwt.signAsync(
      { sub: userId, kind: 'sse' },
      { expiresIn },
    );
    return { token, expiresIn };
  }

  private async resolveReferralForEmail(
    email: string,
    referralCode?: string,
  ): Promise<string | null> {
    const friendCode = referralCode?.trim();
    if (!friendCode) return null;

    const referrer = await this.referral.findReferrerByCode(friendCode);
    if (!referrer) {
      throw new BadRequestException('Invalid referral code');
    }
    const referrerUser = await this.users.findById(referrer.id);
    if (referrerUser?.email.toLowerCase() === email) {
      throw new BadRequestException('You cannot use your own referral code');
    }
    return referrer.id;
  }

  /* ────────────────────────────────────────────────────────
     PASSWORD RESET (6-digit code).
     - Anti-enumeration: forgot-password ALWAYS replies { ok: true }.
     - reset-password replies generic on any wrong input.
     ──────────────────────────────────────────────────────── */

  private resetSecret(): string {
    return (
      process.env.OTP_HMAC_SECRET?.trim() || process.env.JWT_ACCESS_SECRET || ''
    );
  }

  private hashResetCode(userId: string, code: string): string {
    return createHmac('sha256', this.resetSecret())
      .update(`reset:${userId}:${code}`)
      .digest('hex');
  }

  /** Constant-time hex comparison (length-independent). */
  private safeHexEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Request a reset code. Always returns { ok: true } regardless of whether the
   * email exists — never leaks account existence. Resend cooldown 2 minutes.
   */
  async forgotPassword(emailRaw: string): Promise<{ ok: true }> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.users.findByEmail(email);

    // Only act when the user exists; the response is identical either way.
    if (user) {
      const recent = await this.prisma.passwordReset.findFirst({
        where: { userId: user.id, usedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const onCooldown =
        !!recent &&
        Date.now() - recent.createdAt.getTime() < RESET_RESEND_COOLDOWN_MS;

      if (!onCooldown) {
        const code = randomInt(100000, 1000000).toString();
        const codeHash = this.hashResetCode(user.id, code);
        const expiresAt = new Date(Date.now() + RESET_TTL_MS);

        // Void all unused prior codes, then issue a fresh one.
        await this.prisma.passwordReset.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await this.prisma.passwordReset.create({
          data: { userId: user.id, codeHash, expiresAt },
        });

        try {
          await this.resend.sendPasswordResetEmail(user.email, code);
        } catch (err) {
          this.logger.error(`Reset email failed for ${email}: ${String(err)}`);
          // Still reply ok — never leak email-service failure.
        }
      }
    }
    return { ok: true };
  }

  /**
   * Verify code + set new password + revoke ALL refresh tokens (kick every session).
   * Generic error on any mismatch. Does NOT auto-login — user signs in fresh.
   */
  async resetPassword(
    emailRaw: string,
    code: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const email = emailRaw.trim().toLowerCase();
    const fail = () => {
      throw new UnauthorizedException('Invalid or expired reset code.');
    };

    const user = await this.users.findByEmail(email);
    if (!user) fail();

    const reset = await this.prisma.passwordReset.findFirst({
      where: { userId: user!.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!reset) fail();
    if (reset!.expiresAt < new Date()) fail();
    if (reset!.attempts >= MAX_RESET_ATTEMPTS) {
      await this.prisma.passwordReset.update({
        where: { id: reset!.id },
        data: { usedAt: new Date() },
      });
      fail();
    }

    const candidate = this.hashResetCode(user!.id, code.trim());
    if (!this.safeHexEqual(candidate, reset!.codeHash)) {
      await this.prisma.passwordReset.update({
        where: { id: reset!.id },
        data: { attempts: { increment: 1 } },
      });
      fail();
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user!.id },
        data: { passwordHash, emailVerified: true }, // code ownership proves email
      }),
      this.prisma.passwordReset.update({
        where: { id: reset!.id },
        data: { usedAt: new Date() },
      }),
      // Revoke ALL refresh tokens → every existing session is kicked.
      this.prisma.refreshToken.updateMany({
        where: { userId: user!.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    void this.resend.sendPasswordChangedEmail(user!.email).catch(() => {});
    return { ok: true };
  }

  /** Secret for OTP HMAC. Falls back to the JWT secret so legacy deployments keep working. */
  private otpSecret(): string {
    return (
      process.env.OTP_HMAC_SECRET?.trim() || process.env.JWT_ACCESS_SECRET || ''
    );
  }

  /** Hash a pending OTP: HMAC-SHA256(secret, `${purpose}:${userId}:${code}`). */
  private hashOtp(userId: string, code: string, purpose = 'register'): string {
    return createHmac('sha256', this.otpSecret())
      .update(`${purpose}:${userId}:${code}`)
      .digest('hex');
  }

  private async issueOtpForUser(
    userId: string,
    email: string,
  ): Promise<{ otp: string; devOtp?: string }> {
    const user = await this.users.findById(userId);
    if (user?.otpExpiresAt) {
      const issuedAt = user.otpExpiresAt.getTime() - OTP_TTL_MS;
      if (Date.now() - issuedAt < OTP_RESEND_COOLDOWN_MS) {
        throw new BadRequestException(
          'Please wait 2 minutes before requesting another code.',
        );
      }
    }

    const otp = randomInt(100000, 1000000).toString(); // CSPRNG, 6 digits
    const otpCodeHash = this.hashOtp(userId, otp); // HMAC-SHA256 bound to the user
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    await this.users.setOtpPending(userId, otpCodeHash, otpExpiresAt);

    try {
      await this.resend.sendOtpEmail(email, otp);
    } catch (err) {
      this.logger.error(`OTP email failed for ${email}: ${String(err)}`);
      throw err;
    }

    return {
      otp,
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,
    };
  }

  /** Issue access + refresh token (HS256). Dipakai register/login/refresh. */
  private async issueTokens(userId: string, email: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId, email });
    const rawRefresh = randomBytes(48).toString('hex');
    const refreshTokenHash = createHash('sha256')
      .update(rawRefresh)
      .digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: refreshTokenHash, expiresAt },
    });
    return { accessToken, refreshToken: rawRefresh, expiresAt };
  }
}
