import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_DAILY_LIMIT = 10;

@Injectable()
export class WalletQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  dailyLimit(): number {
    const raw = this.config.get<string>('WALLET_DAILY_LIMIT');
    const n = raw ? parseInt(raw, 10) : DEFAULT_DAILY_LIMIT;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
  }

  private utcDayBounds(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  async countToday(): Promise<number> {
    const { start, end } = this.utcDayBounds();
    return this.prisma.walletAllocationLog.count({
      where: { createdAt: { gte: start, lt: end } },
    });
  }

  async getStatus() {
    const limit = this.dailyLimit();
    const usedToday = await this.countToday();
    return {
      dailyLimit: limit,
      usedToday,
      remaining: Math.max(0, limit - usedToday),
    };
  }

  async assertSlotAvailable(): Promise<void> {
    const { remaining, dailyLimit, usedToday } = await this.getStatus();
    if (remaining <= 0) {
      throw new HttpException(
        {
          message: `Daily wallet limit reached (${dailyLimit} new wallets per day). Try again tomorrow (UTC).`,
          code: 'WALLET_DAILY_LIMIT',
          dailyLimit,
          usedToday,
          remaining: 0,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordAllocation(params: {
    userId: string;
    username?: string | null;
    partyId: string;
  }): Promise<void> {
    await this.prisma.walletAllocationLog.create({
      data: {
        userId: params.userId,
        username: params.username?.trim() || null,
        partyId: params.partyId,
      },
    });
  }
}
