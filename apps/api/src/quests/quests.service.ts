import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { QuestStatus, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  points: number;
}

export interface UserDashboardStats {
  totalPoints: number;
  questsCompleted: number;
  txCount: number;
  weeklyRank: number;
}

export interface ActivityItem {
  type: 'quest_completed' | 'task_verified' | 'cc_transfer';
  title: string;
  detail: string;
  time: string;
}

@Injectable()
export class QuestsService {
  private readonly logger = new Logger(QuestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /* ─── Quest list / detail ─── */

  async listQuests(status?: QuestStatus) {
    const quests = await this.prisma.quest.findMany({
      where: status ? { status } : undefined,
      include: { tasks: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return quests.map((q) => ({
      ...q,
      tags: this.parseTags(q.tags),
    }));
  }

  async getQuest(questId: string) {
    const q = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: { tasks: { orderBy: { order: 'asc' } } },
    });
    if (!q) throw new NotFoundException('Quest not found');
    return { ...q, tags: this.parseTags(q.tags) };
  }

  /* ─── User progress ─── */

  async getUserProgress(userId: string, questId: string) {
    const [completions, submissions] = await Promise.all([
      this.prisma.questCompletion.findMany({ where: { userId } }),
      this.prisma.questSubmission.findMany({
        where: { userId, questId },
        include: { task: true },
      }),
    ]);
    const completed = completions.some((c) => c.questId === questId);
    return { completed, submissions };
  }

  async getUserAllProgress(userId: string) {
    const [completions, submissions] = await Promise.all([
      this.prisma.questCompletion.findMany({ where: { userId } }),
      this.prisma.questSubmission.findMany({ where: { userId } }),
    ]);
    const completedQuestIds = completions.map((c) => c.questId);
    const submittedTaskIds = submissions.map((s) => s.taskId);
    return { completedQuestIds, submittedTaskIds, submissions };
  }

  /* ─── Task submission ─── */

  async submitTask(params: {
    userId: string;
    userPartyId: string;
    questId: string;
    taskId: string;
    proof?: string;
  }): Promise<{ status: SubmissionStatus; alreadyDone: boolean }> {
    const { userId, questId, taskId, proof } = params;

    // Check existing submission
    const existing = await this.prisma.questSubmission.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (existing) {
      if (existing.status === SubmissionStatus.VERIFIED) {
        return { status: SubmissionStatus.VERIFIED, alreadyDone: true };
      }
      throw new ConflictException('Task already submitted and pending review');
    }

    // Verify task belongs to quest
    const task = await this.prisma.questTask.findFirst({
      where: { id: taskId, questId },
    });
    if (!task) throw new NotFoundException('Task not found in this quest');

    // Auto-verify logic by task type
    const autoVerify = this.canAutoVerify(task.type, task.correctAnswer, proof);

    const submission = await this.prisma.questSubmission.create({
      data: {
        userId,
        questId,
        taskId,
        proof: proof ?? null,
        status: autoVerify ? SubmissionStatus.VERIFIED : SubmissionStatus.PENDING,
        verifiedAt: autoVerify ? new Date() : null,
      },
    });

    this.logger.log(
      `Task submitted: user=${userId.slice(0, 8)} quest=${questId} task=${taskId} auto=${String(autoVerify)}`,
    );

    return { status: submission.status, alreadyDone: false };
  }

  /* ─── Quest completion (after all tasks verified) ─── */

  async checkAndCompleteQuest(params: {
    userId: string;
    questId: string;
    ledgerTxId?: string;
  }): Promise<{ justCompleted: boolean; rewardMicroCc: bigint }> {
    const { userId, questId, ledgerTxId } = params;

    const existing = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (existing) return { justCompleted: false, rewardMicroCc: existing.rewardMicroCc };

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: { tasks: true },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    // Check all tasks are verified
    const verified = await this.prisma.questSubmission.findMany({
      where: { userId, questId, status: SubmissionStatus.VERIFIED },
    });
    const allDone = quest.tasks.every((t) =>
      verified.some((s) => s.taskId === t.id),
    );

    if (!allDone) return { justCompleted: false, rewardMicroCc: 0n };

    const rewardMicroCc = BigInt(Math.round(quest.rewardCc * 1_000_000));
    await this.prisma.questCompletion.create({
      data: { userId, questId, rewardMicroCc, ledgerTxId: ledgerTxId ?? null },
    });

    this.logger.log(
      `Quest completed: user=${userId.slice(0, 8)} quest=${questId} reward=${quest.rewardCc} CC`,
    );

    return { justCompleted: true, rewardMicroCc };
  }

  /* ─── Admin: create/seed quests ─── */

  async upsertQuest(data: {
    id?: string;
    title: string;
    org: string;
    orgSlug: string;
    description: string;
    banner?: string;
    rewardCc: number;
    rewardPool?: string;
    deadline?: string;
    status?: QuestStatus;
    tags?: string[];
    tasks?: Array<{
      id?: string;
      type: string;
      title: string;
      description?: string;
      points?: number;
      target?: string;
      order?: number;
      correctAnswer?: string;
    }>;
  }) {
    const tagsJson = JSON.stringify(data.tags ?? []);
    const quest = await this.prisma.quest.upsert({
      where: { id: data.id ?? '' },
      create: {
        title: data.title,
        org: data.org,
        orgSlug: data.orgSlug,
        description: data.description,
        banner: data.banner ?? 'linear-gradient(135deg,#1e293b,#0f172a)',
        rewardCc: data.rewardCc,
        rewardPool: data.rewardPool ?? `${data.rewardCc} CC`,
        deadline: data.deadline ?? null,
        status: data.status ?? QuestStatus.ACTIVE,
        tags: tagsJson,
      },
      update: {
        title: data.title,
        org: data.org,
        orgSlug: data.orgSlug,
        description: data.description,
        banner: data.banner ?? 'linear-gradient(135deg,#1e293b,#0f172a)',
        rewardCc: data.rewardCc,
        rewardPool: data.rewardPool ?? `${data.rewardCc} CC`,
        deadline: data.deadline ?? null,
        status: data.status ?? QuestStatus.ACTIVE,
        tags: tagsJson,
      },
    });

    if (data.tasks) {
      for (const [i, t] of data.tasks.entries()) {
        await this.prisma.questTask.upsert({
          where: { id: t.id ?? '' },
          create: {
            questId: quest.id,
            type: t.type,
            title: t.title,
            description: t.description ?? null,
            points: t.points ?? 10,
            target: t.target ?? null,
            order: t.order ?? i,
            correctAnswer: t.correctAnswer ?? null,
          },
          update: {
            type: t.type,
            title: t.title,
            description: t.description ?? null,
            points: t.points ?? 10,
            target: t.target ?? null,
            order: t.order ?? i,
            correctAnswer: t.correctAnswer ?? null,
          },
        });
      }
    }

    return quest;
  }

    /* ─── Leaderboard ─── */

  /**
   * Build leaderboard from quest completions + transaction data.
   * Returns top users sorted by total points (quest submissions * points).
   */
  async getLeaderboard(
    period: 'weekly' | 'monthly' | 'all',
    page = 1,
    pageSize = 10,
  ): Promise<{ rows: LeaderboardRow[]; total: number; page: number; pageSize: number }> {
    const now = new Date();
    let since: Date | undefined;
    if (period === 'weekly') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'monthly') {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Aggregate points from verified quest submissions
    const subs = await this.prisma.questSubmission.findMany({
      where: {
        status: 'VERIFIED',
        ...(since ? { verifiedAt: { gte: since } } : {}),
      },
      include: {
        task: { select: { points: true } },
        user: { select: { id: true, username: true, displayName: true } },
      },
    });

    // Aggregate points per user
    const pointsMap = new Map<string, { userId: string; username: string | null; displayName: string | null; points: number }>();
    for (const s of subs) {
      const existing = pointsMap.get(s.userId);
      if (existing) {
        existing.points += s.task.points;
      } else {
        pointsMap.set(s.userId, {
          userId: s.user.id,
          username: s.user.username,
          displayName: s.user.displayName,
          points: s.task.points,
        });
      }
    }

    // Also include quest completions (bonus points = rewardCc * 10)
    const completions = await this.prisma.questCompletion.findMany({
      where: since ? { completedAt: { gte: since } } : {},
      include: { quest: { select: { rewardCc: true } } },
    });
    for (const c of completions) {
      const bonus = Math.round(c.quest.rewardCc * 10);
      const existing = pointsMap.get(c.userId);
      if (existing) {
        existing.points += bonus;
      }
    }

    // Sort descending
    const sorted = [...pointsMap.values()].sort((a, b) => b.points - a.points);
    const total = sorted.length;
    const skip = (page - 1) * pageSize;
    const pageRows = sorted.slice(skip, skip + pageSize);

    const rows: LeaderboardRow[] = pageRows.map((u, i) => ({
      rank: skip + i + 1,
      userId: u.userId,
      username: u.username ?? 'unknown',
      displayName: u.displayName ?? u.username ?? 'Unknown',
      points: u.points,
    }));

    return { rows, total, page, pageSize };
  }

  /* ─── User dashboard stats ─── */

  async getUserDashboardStats(userId: string): Promise<UserDashboardStats> {
    const [completions, submissions, txCount] = await Promise.all([
      this.prisma.questCompletion.findMany({ where: { userId } }),
      this.prisma.questSubmission.findMany({
        where: { userId, status: 'VERIFIED' },
        include: { task: { select: { points: true } } },
      }),
      this.prisma.ccTransaction.count({ where: { userId } }),
    ]);

    const totalPoints = submissions.reduce((s, sub) => s + sub.task.points, 0);
    const questsCompleted = completions.length;

    // Weekly rank approximation
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklySubs = await this.prisma.questSubmission.findMany({
      where: { status: 'VERIFIED', verifiedAt: { gte: weekAgo } },
      include: { task: { select: { points: true } } },
    });
    const weeklyMap = new Map<string, number>();
    for (const s of weeklySubs) {
      weeklyMap.set(s.userId, (weeklyMap.get(s.userId) ?? 0) + s.task.points);
    }
    const myWeeklyPts = weeklyMap.get(userId) ?? 0;
    const sorted = [...weeklyMap.values()].sort((a, b) => b - a);
    const weeklyRank = sorted.indexOf(myWeeklyPts) + 1 || sorted.length + 1;

    return {
      totalPoints,
      questsCompleted,
      txCount,
      weeklyRank,
    };
  }

  /* ─── Recent activity feed ─── */

  async getRecentActivity(userId: string, limit = 8): Promise<ActivityItem[]> {
    const [submissions, txs, completions] = await Promise.all([
      this.prisma.questSubmission.findMany({
        where: { userId, status: 'VERIFIED' },
        orderBy: { verifiedAt: 'desc' },
        take: limit,
        include: { task: { select: { title: true, points: true } }, quest: { select: { title: true } } },
      }),
      this.prisma.ccTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.questCompletion.findMany({
        where: { userId },
        orderBy: { completedAt: 'desc' },
        take: limit,
        include: { quest: { select: { title: true, rewardCc: true } } },
      }),
    ]);

    const items: ActivityItem[] = [];

    for (const c of completions) {
      items.push({
        type: 'quest_completed',
        title: 'Quest completed',
        detail: `${c.quest.title}${c.quest.rewardCc > 0 ? ` · +${c.quest.rewardCc} CC` : ''}`,
        time: c.completedAt.toISOString(),
      });
    }

    for (const s of submissions) {
      items.push({
        type: 'task_verified',
        title: 'Task verified',
        detail: `${s.task.title} · +${s.task.points} pts`,
        time: (s.verifiedAt ?? s.submittedAt).toISOString(),
      });
    }

    for (const tx of txs) {
      const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
      const sign = tx.type === 'TRANSFER_OUT' ? '−' : '+';
      items.push({
        type: 'cc_transfer',
        title: tx.type === 'TRANSFER_OUT' ? 'CC sent' : tx.type === 'QUEST_REWARD' ? 'Quest reward' : 'CC received',
        detail: `${sign}${ccAmt.toFixed(2)} CC${tx.description ? ' · ' + tx.description : ''}`,
        time: tx.createdAt.toISOString(),
      });
    }

    // Sort by time desc and take first `limit`
    return items
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, limit);
  }

  /* ─── Helpers ─── */

  private canAutoVerify(
    type: string,
    correctAnswer: string | null,
    proof?: string,
  ): boolean {
    switch (type) {
      case 'visit_website':
        return true;
      case 'quiz_choice':
        if (!correctAnswer || !proof) return false;
        return proof.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
      case 'submit_canton_address':
        return !!(proof && proof.includes('::'));
      default:
        // social tasks, email, etc. — require manual verification or honor system
        return true;
    }
  }

  private parseTags(raw: string): string[] {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
}
