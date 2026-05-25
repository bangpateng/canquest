import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralService } from '../users/referral.service';
import { UsersService } from '../users/users.service';
import { resolvePublicAvatarUrl } from '../users/user-avatar-url';
import {
  normalizeCantonPartyId,
  normalizeWalletUsername,
} from '../common/canton-party-id';
import { ResendEmailService } from './resend-email.service';

const BCRYPT_ROUNDS = 12;
const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 2 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly referral: ReferralService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly resend: ResendEmailService,
  ) {}

  async register(dto: { email: string; password: string; referralCode?: string }) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.users.findByEmail(email);
    if (existing?.emailVerified) {
      throw new ConflictException('Email already registered');
    }

    const referredById = await this.resolveReferralForEmail(email, dto.referralCode);
    const skipOtp = process.env.AUTH_REGISTER_SKIP_OTP === 'true';
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    if (existing && !existing.emailVerified) {
      await this.prisma.refreshToken.deleteMany({ where: { userId: existing.id } });
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
      localPart.charAt(0).toUpperCase() + localPart.slice(1, 80).replace(/[.+]/g, ' ');

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

  async verifyOtp(userId: string, code: string) {
    const user = await this.users.findById(userId);
    if (!user?.otpCodeHash || !user.otpExpiresAt) {
      throw new UnauthorizedException('No pending verification');
    }
    if (user.otpExpiresAt < new Date()) {
      throw new UnauthorizedException('OTP expired');
    }
    const hash = createHash('sha256').update(code.trim()).digest('hex');
    if (hash !== user.otpCodeHash) {
      throw new UnauthorizedException('Invalid OTP');
    }

    await this.users.setVerified(userId);
    await this.referral.completeReferralForUser(userId);

    const fresh = await this.users.findById(userId);
    if (!fresh) throw new UnauthorizedException();
    return this.issueTokens(fresh.id, fresh.email);
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
    const earnPoints = await this.users.reconcileEarnPoints(userId);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      username: normalizeWalletUsername(user.username) ?? user.username,
      cantonPartyId: normalizeCantonPartyId(user.cantonPartyId) ?? user.cantonPartyId,
      twitterUsername: user.twitterUsername,
      twitterConnectedAt: user.twitterConnectedAt?.toISOString() ?? null,
      earnPoints,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      avatarUrl: resolvePublicAvatarUrl(user),
    };
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

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpCodeHash = createHash('sha256').update(otp).digest('hex');
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
