import {

  BadRequestException,

  ConflictException,

  Injectable,

  UnauthorizedException,

} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import * as bcrypt from 'bcrypt';

import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

import { ProfileAvatarService } from '../users/profile-avatar.service';
import { ReferralService } from '../users/referral.service';
import { UsersService } from '../users/users.service';



const BCRYPT_ROUNDS = 12;



@Injectable()

export class AuthService {

  constructor(
    private readonly users: UsersService,
    private readonly avatars: ProfileAvatarService,
    private readonly referral: ReferralService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}



  async register(dto: {
    displayName: string;
    email: string;
    password: string;
    referralCode?: string;
  }) {
    const existing = await this.users.findByEmail(dto.email);

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const email = dto.email.trim().toLowerCase();
    let referredById: string | null = null;
    const friendCode = dto.referralCode?.trim();
    if (friendCode) {
      const referrer = await this.referral.findReferrerByCode(friendCode);
      if (!referrer) {
        throw new BadRequestException('Invalid referral code');
      }
      const referrerUser = await this.users.findById(referrer.id);
      if (referrerUser?.email.toLowerCase() === email) {
        throw new BadRequestException('You cannot use your own referral code');
      }
      referredById = referrer.id;
    }

    const skipOtp = process.env.AUTH_REGISTER_SKIP_OTP === 'true';
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const referralCode = await this.referral.generateUniqueReferralCode();

    const user = await this.users.create({
      email,
      passwordHash,
      referredById,
      referralCode,
      displayName: dto.displayName.trim(),
      emailVerified: skipOtp,
    });

    if (skipOtp) {
      await this.referral.completeReferralForUser(user.id);
      return this.issueTokens(user.id, user.email);
    }



    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const otpCodeHash = createHash('sha256').update(otp).digest('hex');

    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.users.setOtpPending(user.id, otpCodeHash, otpExpiresAt);



    return {

      userId: user.id,

      message: 'Registration started. Verify OTP sent to your email.',

      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined,

    };

  }



  async verifyOtp(userId: string, code: string) {

    const user = await this.users.findById(userId);

    if (!user?.otpCodeHash || !user.otpExpiresAt) {

      throw new UnauthorizedException('No pending verification');

    }

    if (user.otpExpiresAt < new Date()) {

      throw new UnauthorizedException('OTP expired');

    }

    const hash = createHash('sha256').update(code).digest('hex');

    if (hash !== user.otpCodeHash) {

      throw new UnauthorizedException('Invalid OTP');

    }

    await this.users.setVerified(userId);

    await this.referral.completeReferralForUser(userId);

    const fresh = await this.users.findById(userId);

    if (!fresh) throw new UnauthorizedException();

    return this.issueTokens(fresh.id, fresh.email);

  }



  async login(dto: { email: string; password: string }) {
    const email = dto.email.trim().toLowerCase();
    const password = dto.password;

    const user = await this.users.findByEmail(email);

    if (!user) {

      throw new UnauthorizedException('Invalid credentials');

    }

    const ok = await bcrypt.compare(password, user.passwordHash);

    if (!ok) {

      throw new UnauthorizedException('Invalid credentials');

    }

    if (!user.emailVerified) {

      throw new UnauthorizedException('Email not verified');

    }

    return this.issueTokens(user.id, user.email);

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
      username: user.username,
      cantonPartyId: user.cantonPartyId,
      twitterUsername: user.twitterUsername,
      twitterConnectedAt: user.twitterConnectedAt?.toISOString() ?? null,
      earnPoints,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      avatarUrl: this.avatars.hasAvatar(user.avatarPath)
        ? this.avatars.avatarPublicPath(user.id)
        : null,
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

