import {

  BadRequestException,

  ConflictException,

  ForbiddenException,

  Injectable,

  UnauthorizedException,

} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import * as bcrypt from 'bcrypt';

import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';

import { ProfileAvatarService } from '../users/profile-avatar.service';
import { UsersService } from '../users/users.service';



const BCRYPT_ROUNDS = 12;



@Injectable()

export class AuthService {

  constructor(
    private readonly users: UsersService,
    private readonly avatars: ProfileAvatarService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}



  private validateInviteCode(invite?: string): void {

    const raw = process.env.INVITE_CODES?.trim();

    if (!raw) {

      if (process.env.NODE_ENV === 'production') {

        throw new BadRequestException(

          'Server misconfiguration: INVITE_CODES must be set in production.',

        );

      }

      return;

    }

    const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);

    const code = invite?.trim() ?? '';

    if (!code) {

      throw new ForbiddenException('Invitation code is required');

    }

    if (!allowed.includes(code)) {

      throw new ForbiddenException('Invalid invitation code');

    }

  }



  async register(dto: {

    displayName: string;

    email: string;

    password: string;

    inviteCode?: string;

  }) {

    const existing = await this.users.findByEmail(dto.email);

    if (existing) {

      throw new ConflictException('Email already registered');

    }



    this.validateInviteCode(dto.inviteCode);



    const skipOtp = process.env.AUTH_REGISTER_SKIP_OTP === 'true';

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);



    const user = await this.users.create({

      email: dto.email.trim().toLowerCase(),

      passwordHash,

      inviteCode: dto.inviteCode?.trim(),

      displayName: dto.displayName.trim(),

      emailVerified: skipOtp,

    });



    if (skipOtp) {

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

