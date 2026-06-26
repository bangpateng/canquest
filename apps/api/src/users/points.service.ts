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
        if (!existing.username && user.username)
          existing.username = user.username;
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
   * Net spendable points = earnPoints - total earn entry cost spent.
   * Ini adalah satu-satunya sumber kebenaran untuk semua halaman
   * (dashboard, quest, leaderboard). Poin terpotong tiap user ikut Earn
   * (jalur method='points') — catatan ada di model EarnEntry.
   */
  async getNetPoints(userId: string): Promise<number> {
    const [earnPoints, spentResult] = await Promise.all([
      this.reconcileUserEarnPoints(userId),
      this.prisma.earnEntry.aggregate({
        where: { userId },
        _sum: { pointsSpent: true },
      }),
    ]);
    const spentPoints = spentResult._sum.pointsSpent ?? 0;
    return Math.max(0, earnPoints - spentPoints);
  }

  /**
   * Net points per user untuk leaderboard — SINKRON dengan dashboard.
   *
   * Net = earnPoints - total earn entry cost spent.
   * Berlaku untuk semua periode (weekly, monthly, all).
   *
   * Untuk weekly/monthly: hitung earned dalam periode, kurangi earn entry cost
   * dalam periode yang sama.
   */
  async buildNetPointsByUser(since?: Date): Promise<PointsAggregateRow[]> {
    // 1. Hitung earned points per user (dari activity records dalam periode)
    const earnedRows = await this.buildPointsByUser(since);
    if (earnedRows.length === 0) return [];

    // 2. Hitung total earn entry cost per user dalam periode yang sama
    const entrySpentRows = await this.prisma.earnEntry.groupBy({
      by: ['userId'],
      where: since ? { createdAt: { gte: since } } : {},
      _sum: { pointsSpent: true },
    });

    const spentMap = new Map<string, number>();
    for (const row of entrySpentRows) {
      spentMap.set(row.userId, row._sum.pointsSpent ?? 0);
    }

    // 3. Net = earned - earn entry cost (min 0)
    return earnedRows
      .map((r) => ({
        ...r,
        points: Math.max(0, r.points - (spentMap.get(r.id) ?? 0)),
      }))
      .filter((r) => r.points > 0)
      .sort((a, b) => b.points - a.points);
  }

  /**
   * Saldo points mutakhir (snapshot) per user untuk leaderboard "All time".
   *
   * Berbeda dari buildNetPointsByUser (yang menghitung earned-in-window);
   * ini = total lifetime earned - total spent sepanjang masa, mengikuti
   * getNetPoints(). Reconcile tiap user ke User.earnPoints dulu supaya
   * konsisten dengan saldo Dashboard / /users/me/points.
   */
  async buildRemainingPointsByUser(): Promise<PointsAggregateRow[]> {
    // 1. Total earned per user (lifetime) dari activity records.
    const earnedRows = await this.buildPointsByUser();
    if (earnedRows.length === 0) return [];

    // 2. Total earn entry cost sepanjang masa per user.
    const entrySpentRows = await this.prisma.earnEntry.groupBy({
      by: ['userId'],
      _sum: { pointsSpent: true },
    });
    const spentMap = new Map<string, number>();
    for (const row of entrySpentRows) {
      spentMap.set(row.userId, row._sum.pointsSpent ?? 0);
    }

    // 3. Reconcile tiap user ke User.earnPoints (Math.max manual credits),
    //    lalu saldo = max(stored earned, computed earned) - spent (min 0).
    const userIds = earnedRows.map((r) => r.id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, earnPoints: true },
    });
    const storedEarned = new Map<string, number>();
    for (const u of users) storedEarned.set(u.id, u.earnPoints);

    const rows = earnedRows.map((r) => {
      const totalEarned = Math.max(storedEarned.get(r.id) ?? 0, r.points);
      const spent = spentMap.get(r.id) ?? 0;
      return { ...r, points: Math.max(0, totalEarned - spent) };
    });

    // 4. Persen otomatis reconciled earnPoints balik ke DB (selisih > 0).
    await Promise.all(
      rows
        .filter((r) => {
          const stored = storedEarned.get(r.id) ?? 0;
          const computed = earnedRows.find((e) => e.id === r.id)!.points;
          return computed > stored;
        })
        .map((r) => {
          const computed = earnedRows.find((e) => e.id === r.id)!.points;
          return this.prisma.user.update({
            where: { id: r.id },
            data: { earnPoints: computed },
          });
        }),
    );

    return rows.filter((r) => r.points > 0).sort((a, b) => b.points - a.points);
  }
}
