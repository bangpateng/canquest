import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PointsService } from './points.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

/** Saldo points: total (lifetime earned), used (Earn events), remaining (net). */
export interface PointsBalance {
  total: number;
  used: number;
  remaining: number;
}

@Controller('users')
export class PointsController {
  constructor(
    private readonly points: PointsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Single source of truth untuk saldo points pengguna.
   * Selalu fresh: reconcile User.earnPoints + aggregate EarnEntry live.
   */
  @Get('me/points')
  @UseGuards(AuthGuard('jwt'))
  @SkipThrottle()
  async myPoints(@Req() req: AuthedReq): Promise<PointsBalance> {
    const userId = req.user.userId;
    // Paralel: total (reconcile), used (aggregate), remaining (net).
    // remaining juga reconcile internal → total dipakai bareng di sini.
    const [total, usedResult, remaining] = await Promise.all([
      this.points.reconcileUserEarnPoints(userId),
      this.prisma.earnEntry.aggregate({
        where: { userId },
        _sum: { pointsSpent: true },
      }),
      this.points.getNetPoints(userId),
    ]);
    const used = usedResult._sum.pointsSpent ?? 0;
    return { total, used, remaining };
  }
}
