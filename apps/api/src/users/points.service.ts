import { Injectable } from '@nestjs/common';
import { SubmissionStatus } from '../common/prisma-types';
import { PrismaService } from '../prisma/prisma.service';

/** Minimal user fields carried in leaderboard aggregation. */
export type PointsUserSlice = {
  id: string;
  username: string | null;
  displayName: string | null;
  cantonPartyId: string | null;
};

export type PointsAggregateRow = PointsUserSlice & { points: number };

const userSelect = {
  id: true,
  username: true,
  displayName: true,
  cantonPartyId: true,
} as const;

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lifetime or period points from every source:
   * - Verified quest / earn / campaign task submissions
   * - Quest completion bonus (rewardCc × 10)
   * - Spin wheel wins (rewardType = points)
   * - Referral rewards (referrer)
   */
  async aggregateUserPoints(userId: string, since?: Date): Promise<number> {
    const rows = await this.buildPointsByUser(since);
    return rows.find((r) => r.id === userId)?.points ?? 0;
  }

  /** All users with > 0 points in the window (or lifetime if since omitted). */
  async buildPointsByUser(since?: Date): Promise<PointsAggregateRow[]> {
    const map = new Map<string, PointsAggregateRow>();

    const bump = (user: PointsUserSlice, delta: number) => {
      if (delta <= 0) return;
      const existing = map.get(user.id);
      if (existing) {
        existing.points += delta;
        if (!existing.username && user.username) existing.username = user.username;
        if (!existing.displayName && user.displayName) {
          existing.displayName = user.displayName;
        }
        if (!existing.cantonPartyId && user.cantonPartyId) {
          existing.cantonPartyId = user.cantonPartyId;
        }
      } else {
        map.set(user.id, { ...user, points: delta });
      }
    };

    const submissions = await this.prisma.questSubmission.findMany({
      where: {
        status: SubmissionStatus.VERIFIED,
        ...(since ? { verifiedAt: { gte: since } } : {}),
      },
      include: {
        task: { select: { points: true } },
        user: { select: userSelect },
      },
    });
    for (const s of submissions) {
      bump(s.user, s.task.points);
    }

    const completions = await this.prisma.questCompletion.findMany({
      where: since ? { completedAt: { gte: since } } : {},
      include: {
        quest: { select: { rewardCc: true } },
        user: { select: userSelect },
      },
    });
    for (const c of completions) {
      bump(c.user, Math.round(c.quest.rewardCc * 10));
    }

    const spinWins = await this.prisma.spinResult.findMany({
      where: since ? { createdAt: { gte: since } } : {},
      include: {
        spinItem: { select: { rewardType: true, rewardPoints: true } },
        user: { select: userSelect },
      },
    });
    for (const r of spinWins) {
      if (r.spinItem.rewardType !== 'points') continue;
      bump(r.user, r.spinItem.rewardPoints ?? 0);
    }

    const referrals = await this.prisma.referralReward.findMany({
      where: since ? { createdAt: { gte: since } } : {},
      include: { referrer: { select: userSelect } },
    });
    for (const ref of referrals) {
      bump(ref.referrer, ref.points);
    }

    return [...map.values()].filter((r) => r.points > 0);
  }

  /**
   * Sync User.earnPoints with aggregated lifetime total (Math.max keeps manual credits safe).
   */
  async reconcileUserEarnPoints(userId: string): Promise<number> {
    const [user, computed] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { earnPoints: true },
      }),
      this.aggregateUserPoints(userId),
    ]);
    if (!user) return 0;

    const finalPoints = Math.max(user.earnPoints, computed);
    if (finalPoints !== user.earnPoints) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { earnPoints: finalPoints },
      });
    }
    return finalPoints;
  }

  /**
   * Net spendable points = earnPoints - total spin cost spent.
   * Ini adalah satu-satunya sumber kebenaran untuk semua halaman
   * (spin, dashboard, quest, leaderboard).
   */
  async getNetPoints(userId: string): Promise<number> {
    const [earnPoints, spentResult] = await Promise.all([
      this.reconcileUserEarnPoints(userId),
      this.prisma.spinResult.aggregate({
        where: { userId },
        _sum: { pointsSpent: true },
      }),
    ]);
    const spentPoints = spentResult._sum.pointsSpent ?? 0;
    return Math.max(0, earnPoints - spentPoints);
  }

  /**
   * Net points untuk semua user — dipakai leaderboard.
   * Kurangi spin cost dari total earned per user.
   */
  async buildNetPointsByUser(since?: Date): Promise<PointsAggregateRow[]> {
    const [earned, spentRows] = await Promise.all([
      this.buildPointsByUser(since),
      // Hanya ambil spin spent tanpa filter since (spin cost selalu dikurangi dari total)
      this.prisma.spinResult.groupBy({
        by: ['userId'],
        _sum: { pointsSpent: true },
      }),
    ]);

    const spentMap = new Map<string, number>();
    for (const r of spentRows) {
      spentMap.set(r.userId, r._sum.pointsSpent ?? 0);
    }

    return earned
      .map((row) => ({
        ...row,
        points: Math.max(0, row.points - (spentMap.get(row.id) ?? 0)),
      }))
      .filter((r) => r.points > 0)
      .sort((a, b) => b.points - a.points);
  }
}
