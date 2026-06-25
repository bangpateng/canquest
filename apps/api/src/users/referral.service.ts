import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_REWARD_POINTS = 50;

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  rewardPointsPerInvite(): number {
    const raw = this.config.get<string>('REFERRAL_REWARD_POINTS');
    const n = raw ? parseInt(raw, 10) : DEFAULT_REWARD_POINTS;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_REWARD_POINTS;
  }

  async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = this.randomCode(8);
      const existing = await this.prisma.user.findUnique({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!existing) return code;
    }
    throw new BadRequestException('Could not generate referral code');
  }

  async ensureReferralCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) throw new BadRequestException('User not found');
    if (user.referralCode) return user.referralCode;

    const referralCode = await this.generateUniqueReferralCode();
    await this.prisma.user.update({
      where: { id: userId },
      data: { referralCode },
    });
    return referralCode;
  }

  findReferrerByCode(code: string) {
    const normalized = code.trim().toUpperCase();
    if (!normalized || normalized.length < 4 || normalized.length > 32) {
      return null;
    }
    return this.prisma.user.findUnique({
      where: { referralCode: normalized },
      select: { id: true, emailVerified: true },
    });
  }

  /**
   * After referred user verifies email (or skip-OTP register), credit referrer once.
   */
  async completeReferralForUser(referredUserId: string): Promise<void> {
    const referred = await this.prisma.user.findUnique({
      where: { id: referredUserId },
      select: {
        id: true,
        emailVerified: true,
        referredById: true,
        referralRewardReceived: { select: { id: true } },
      },
    });

    if (!referred?.referredById || !referred.emailVerified) return;
    if (referred.referralRewardReceived) return;
    if (referred.referredById === referredUserId) return;

    const points = this.rewardPointsPerInvite();
    const referrerId = referred.referredById;

    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.referralReward.findUnique({
          where: { referredUserId },
        });
        if (existing) return;

        await tx.referralReward.create({
          data: {
            referrerId,
            referredUserId,
            points,
          },
        });
      });

      await this.users.creditEarnPoints(referrerId, points);
      this.logger.log(
        `Referral reward +${points} pts → referrer ${referrerId} (referred ${referredUserId})`,
      );
    } catch (err) {
      this.logger.warn(`Referral reward skipped for ${referredUserId}: ${err}`);
    }
  }

  async getStats(userId: string, siteOrigin?: string) {
    const referralCode = await this.ensureReferralCode(userId);
    const pointsPerInvite = this.rewardPointsPerInvite();

    const [count, sum] = await Promise.all([
      this.prisma.referralReward.count({ where: { referrerId: userId } }),
      this.prisma.referralReward.aggregate({
        where: { referrerId: userId },
        _sum: { points: true },
      }),
    ]);

    const origin = (siteOrigin ?? '').replace(/\/$/, '');
    const referralLink = origin
      ? `${origin}/?auth=register&ref=${encodeURIComponent(referralCode)}`
      : `/?auth=register&ref=${encodeURIComponent(referralCode)}`;

    return {
      referralCode,
      referralLink,
      pointsPerInvite,
      invitedCount: count,
      pointsEarned: sum._sum.points ?? 0,
    };
  }

  private randomCode(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += CODE_CHARS[randomBytes(1)[0] % CODE_CHARS.length];
    }
    return out;
  }
}
