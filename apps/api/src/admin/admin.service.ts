import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuestStatus, RewardType, SubmissionStatus } from '../common/prisma-types';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly splice: SpliceValidatorService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  /* ────────────────────────────────────────────────────────
     QUEST CRUD
  ──────────────────────────────────────────────────────── */

  async listQuests() {
    const quests = await this.prisma.quest.findMany({
      include: {
        tasks: { orderBy: { order: 'asc' } },
        _count: { select: { completions: true, submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return quests.map((q) => ({ ...q, tags: this.parseTags(q.tags) }));
  }

  async getQuestDetail(questId: string) {
    const q = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: {
        tasks: { orderBy: { order: 'asc' } },
        inviteCodes: { orderBy: { createdAt: 'asc' } },
        _count: { select: { completions: true, winnerDraws: true } },
      },
    });
    if (!q) throw new NotFoundException('Quest not found');
    return { ...q, tags: this.parseTags(q.tags) };
  }

  async createQuest(data: {
    title: string;
    org: string;
    orgSlug: string;
    description: string;
    banner?: string;
    bannerImageUrl?: string | null;
    logoUrl?: string | null;
    rewardCc?: number;
    rewardPool?: string;
    deadline?: string;
    status?: QuestStatus;
    rewardType?: RewardType;
    maxWinners?: number;
    tags?: string[];
    tasks?: Array<{
      type: string;
      title: string;
      description?: string;
      points?: number;
      target?: string;
      order?: number;
      correctAnswer?: string;
    }>;
  }) {
    const quest = await this.prisma.quest.create({
      data: {
        title: data.title,
        org: data.org,
        orgSlug: data.orgSlug,
        description: data.description,
        banner: data.banner ?? 'linear-gradient(135deg,#1e293b,#0f172a)',
        bannerImageUrl: data.bannerImageUrl ?? null,
        logoUrl: data.logoUrl ?? null,
        rewardCc: data.rewardCc ?? 0,
        rewardPool: data.rewardPool ?? (data.rewardCc ? `${data.rewardCc} CC` : 'TBD'),
        deadline: data.deadline ?? null,
        status: data.status ?? QuestStatus.ACTIVE,
        rewardType: data.rewardType ?? RewardType.CC_ONLY,
        maxWinners: data.maxWinners ?? null,
        tags: JSON.stringify(data.tags ?? []),
        tasks: data.tasks
          ? {
              create: data.tasks.map((t, i) => ({
                type: t.type,
                title: t.title,
                description: t.description ?? null,
                points: t.points ?? 10,
                target: t.target ?? null,
                order: t.order ?? i,
                correctAnswer: t.correctAnswer ?? null,
              })),
            }
          : undefined,
      },
      include: { tasks: true },
    });
    this.logger.log(`Quest created: ${quest.title} (${quest.id})`);
    return { ...quest, tags: data.tags ?? [] };
  }

  async updateQuest(
    questId: string,
    data: {
      title?: string;
      org?: string;
      orgSlug?: string;
      description?: string;
      banner?: string;
      bannerImageUrl?: string | null;
      logoUrl?: string | null;
      rewardCc?: number;
      rewardPool?: string;
      deadline?: string | null;
      status?: QuestStatus;
      rewardType?: RewardType;
      maxWinners?: number | null;
      tags?: string[];
    },
  ) {
    const existing = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!existing) throw new NotFoundException('Quest not found');

    const updated = await this.prisma.quest.update({
      where: { id: questId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.org !== undefined && { org: data.org }),
        ...(data.orgSlug !== undefined && { orgSlug: data.orgSlug }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.banner !== undefined && { banner: data.banner }),
        ...(data.bannerImageUrl !== undefined && {
          bannerImageUrl: data.bannerImageUrl,
        }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.rewardCc !== undefined && { rewardCc: data.rewardCc }),
        ...(data.rewardPool !== undefined && { rewardPool: data.rewardPool }),
        ...(data.deadline !== undefined && { deadline: data.deadline }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.rewardType !== undefined && { rewardType: data.rewardType }),
        ...(data.maxWinners !== undefined && { maxWinners: data.maxWinners }),
        ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
      },
    });
    return { ...updated, tags: this.parseTags(updated.tags) };
  }

  async deleteQuest(questId: string) {
    await this.prisma.quest.delete({ where: { id: questId } });
    return { deleted: true };
  }

  /* ────────────────────────────────────────────────────────
     TASK CRUD
  ──────────────────────────────────────────────────────── */

  async addTask(
    questId: string,
    data: {
      type: string;
      title: string;
      description?: string;
      points?: number;
      target?: string;
      order?: number;
      correctAnswer?: string;
    },
  ) {
    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) throw new NotFoundException('Quest not found');
    const count = await this.prisma.questTask.count({ where: { questId } });
    return this.prisma.questTask.create({
      data: {
        questId,
        type: data.type,
        title: data.title,
        description: data.description ?? null,
        points: data.points ?? 10,
        target: data.target ?? null,
        order: data.order ?? count,
        correctAnswer: data.correctAnswer ?? null,
      },
    });
  }

  async updateTask(
    taskId: string,
    data: {
      type?: string;
      title?: string;
      description?: string | null;
      points?: number;
      target?: string | null;
      order?: number;
      correctAnswer?: string | null;
    },
  ) {
    return this.prisma.questTask.update({
      where: { id: taskId },
      data: {
        ...(data.type !== undefined && { type: data.type }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.points !== undefined && { points: data.points }),
        ...(data.target !== undefined && { target: data.target }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.correctAnswer !== undefined && { correctAnswer: data.correctAnswer }),
      },
    });
  }

  async deleteTask(taskId: string) {
    await this.prisma.questTask.delete({ where: { id: taskId } });
    return { deleted: true };
  }

  /* ────────────────────────────────────────────────────────
     PARTICIPANTS
  ──────────────────────────────────────────────────────── */

  async getParticipants(questId: string) {
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: { tasks: true },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    const completions = await this.prisma.questCompletion.findMany({
      where: { questId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            username: true,
            displayName: true,
            cantonPartyId: true,
          },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    const drawn = await this.prisma.winnerDraw.findMany({
      where: { questId },
      select: { userId: true },
    });
    const drawnUserIds = new Set(drawn.map((d) => d.userId));

    return completions.map((c) => ({
      userId: c.userId,
      email: c.user.email,
      username: c.user.username,
      displayName: c.user.displayName,
      cantonPartyId: c.user.cantonPartyId,
      completedAt: c.completedAt,
      rewardMicroCc: c.rewardMicroCc.toString(),
      ledgerTxId: c.ledgerTxId,
      isWinner: drawnUserIds.has(c.userId),
    }));
  }

  /* ────────────────────────────────────────────────────────
     WINNER SELECTION
  ──────────────────────────────────────────────────────── */

  async drawWinners(
    questId: string,
    params: { count?: number; userIds?: string[] },
  ) {
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    let selectedUserIds: string[];

    if (params.userIds && params.userIds.length > 0) {
      // Manual selection
      selectedUserIds = params.userIds;
    } else {
      // Random selection from completions not yet drawn
      const alreadyDrawn = await this.prisma.winnerDraw.findMany({
        where: { questId },
        select: { userId: true },
      });
      const drawnIds = new Set(alreadyDrawn.map((d) => d.userId));

      const completions = await this.prisma.questCompletion.findMany({
        where: { questId, userId: { notIn: [...drawnIds] } },
        select: { userId: true },
      });

      const pool = completions.map((c) => c.userId);
      const limit = params.count ?? quest.maxWinners ?? pool.length;
      selectedUserIds = pool.sort(() => Math.random() - 0.5).slice(0, limit);
    }

    if (selectedUserIds.length === 0) {
      return { added: 0, winners: [] };
    }

    // Get invite codes if needed
    const needCodes =
      quest.rewardType === RewardType.INVITE_CODE ||
      quest.rewardType === RewardType.CC_AND_INVITE;

    const availableCodes = needCodes
      ? await this.prisma.inviteCodePool.findMany({
          where: { questId, userId: null },
          take: selectedUserIds.length,
        })
      : [];

    // Upsert WinnerDraw for each selected user
    const results: Array<{
      userId: string;
      email: string;
      ccAmount: number;
      inviteCode: string | null;
    }> = [];

    for (let i = 0; i < selectedUserIds.length; i++) {
      const uid = selectedUserIds[i]!;
      const code = availableCodes[i] ?? null;

      const existing = await this.prisma.winnerDraw.findUnique({
        where: { questId_userId: { questId, userId: uid } },
      });
      if (existing) continue;

      await this.prisma.winnerDraw.create({
        data: {
          questId,
          userId: uid,
          ccAmount: quest.rewardCc,
          inviteCode: code?.code ?? null,
          distributed: false,
        },
      });

      if (code) {
        await this.prisma.inviteCodePool.update({
          where: { id: code.id },
          data: { userId: uid, assignedAt: new Date() },
        });
      }

      const user = await this.users.findById(uid);
      if (user) results.push({ userId: uid, email: user.email, ccAmount: quest.rewardCc, inviteCode: code?.code ?? null });
    }

    return { added: results.length, winners: results };
  }

  async getWinners(questId: string) {
    const draws = await this.prisma.winnerDraw.findMany({
      where: { questId },
      include: {
        user: {
          select: { id: true, email: true, username: true, displayName: true, cantonPartyId: true },
        },
      },
      orderBy: { drawnAt: 'desc' },
    });
    return draws.map((d) => ({
      drawId: d.id,
      userId: d.userId,
      email: d.user.email,
      username: d.user.username,
      displayName: d.user.displayName,
      cantonPartyId: d.user.cantonPartyId,
      ccAmount: d.ccAmount,
      inviteCode: d.inviteCode,
      distributed: d.distributed,
      ledgerTxId: d.ledgerTxId,
      drawnAt: d.drawnAt,
      distributedAt: d.distributedAt,
    }));
  }

  /* ────────────────────────────────────────────────────────
     REWARD DISTRIBUTION
  ──────────────────────────────────────────────────────── */

  async distributeRewards(questId: string, drawIds?: string[]) {
    const draws = await this.prisma.winnerDraw.findMany({
      where: {
        questId,
        distributed: false,
        ...(drawIds ? { id: { in: drawIds } } : {}),
      },
      include: {
        user: {
          select: { id: true, email: true, username: true, cantonPartyId: true },
        },
      },
    });

    if (draws.length === 0) return { distributed: 0, results: [] };

    const results: Array<{
      userId: string;
      email: string;
      ccSent: boolean;
      ccAmount: number;
      inviteCode: string | null;
    }> = [];

    for (const draw of draws) {
      const user = draw.user;
      let ccSent = false;
      let ledgerTxId: string | null = null;

      if (draw.ccAmount > 0 && user.cantonPartyId) {
        try {
          const offerContractId = await this.splice.createTransferOffer(
            user.cantonPartyId,
            draw.ccAmount,
            `Quest winner reward: ${questId}`,
          );
          if (offerContractId && user.username) {
            ccSent = await this.splice.acceptOfferViaWallet(
              offerContractId,
              user.username,
            );
            if (ccSent) {
              ledgerTxId = offerContractId;
              // Record in CcTransaction
              await this.users.recordTransaction({
                userId: user.id,
                amountCc: draw.ccAmount,
                type: 'QUEST_REWARD',
                description: `Quest winner reward: ${questId}`,
              });
            }
          }
        } catch (err) {
          this.logger.warn(
            `CC reward failed for ${user.email}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      await this.prisma.winnerDraw.update({
        where: { id: draw.id },
        data: {
          distributed: true,
          ledgerTxId: ledgerTxId ?? undefined,
          distributedAt: new Date(),
        },
      });

      results.push({
        userId: draw.userId,
        email: draw.user.email,
        ccSent,
        ccAmount: draw.ccAmount,
        inviteCode: draw.inviteCode,
      });

      this.logger.log(
        `Reward distributed: ${draw.user.email} — ${draw.ccAmount} CC (sent: ${String(ccSent)}) code: ${draw.inviteCode ?? 'none'}`,
      );
    }

    return { distributed: results.length, results };
  }

  /* ────────────────────────────────────────────────────────
     INVITE CODE MANAGEMENT
  ──────────────────────────────────────────────────────── */

  async addInviteCodes(questId: string, codes: string[]) {
    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) throw new NotFoundException('Quest not found');

    const created: string[] = [];
    const skipped: string[] = [];

    for (const code of codes) {
      const trimmed = code.trim();
      if (!trimmed) continue;
      try {
        await this.prisma.inviteCodePool.create({
          data: { questId, code: trimmed },
        });
        created.push(trimmed);
      } catch {
        skipped.push(trimmed);
      }
    }

    return { created: created.length, skipped: skipped.length };
  }

  async getInviteCodes(questId: string) {
    const codes = await this.prisma.inviteCodePool.findMany({
      where: { questId },
      include: {
        user: { select: { email: true, username: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return codes.map((c) => ({
      id: c.id,
      code: c.code,
      assigned: !!c.userId,
      assignedTo: c.user ? { email: c.user.email, username: c.user.username } : null,
      assignedAt: c.assignedAt,
    }));
  }

  /* ────────────────────────────────────────────────────────
     USER MANAGEMENT
  ──────────────────────────────────────────────────────── */

  async listUsers(page = 1, pageSize = 20, search?: string) {
    const skip = (page - 1) * pageSize;
    const q = search?.trim();
    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { username: { contains: q, mode: 'insensitive' as const } },
            { displayName: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          cantonPartyId: true,
          isAdmin: true,
          emailVerified: true,
          createdAt: true,
          ccBalance: { select: { balanceMicroCc: true } },
          _count: { select: { questCompletions: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      users: users.map((u) => ({
        ...u,
        balanceMicroCc: u.ccBalance?.balanceMicroCc?.toString() ?? '0',
        ccBalance: undefined,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async setAdmin(userId: string, isAdmin: boolean) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { isAdmin },
      select: { id: true, email: true, isAdmin: true },
    });
  }

  /** Delete one or more app users (DB only — does not remove Canton party on-chain). */
  async deleteUsers(userIds: string[]) {
    const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException('No user IDs provided');
    }

    const protectedEmails = this.getProtectedAdminEmails();
    const found = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, isAdmin: true },
    });

    const missing = ids.filter((id) => !found.some((u) => u.id === id));
    const blocked = found.filter(
      (u) =>
        u.isAdmin ||
        protectedEmails.has(u.email.toLowerCase()),
    );
    const toDelete = found.filter(
      (u) =>
        !u.isAdmin &&
        !protectedEmails.has(u.email.toLowerCase()),
    );

    if (toDelete.length === 0) {
      throw new BadRequestException(
        blocked.length > 0
          ? 'Cannot delete admin accounts'
          : 'No matching users to delete',
      );
    }

    const deleteIds = toDelete.map((u) => u.id);

    await this.prisma.inviteCodePool.updateMany({
      where: { userId: { in: deleteIds } },
      data: { userId: null, assignedAt: null },
    });

    const result = await this.prisma.user.deleteMany({
      where: { id: { in: deleteIds } },
    });

    for (const u of toDelete) {
      this.logger.warn(`Deleted user ${u.email} (${u.id})`);
    }

    return {
      deleted: result.count,
      blocked: blocked.map((u) => ({ id: u.id, email: u.email, reason: 'admin' })),
      notFound: missing,
    };
  }

  private getProtectedAdminEmails(): Set<string> {
    const raw =
      this.config.get<string>('ADMIN_EMAILS') ??
      process.env.ADMIN_EMAILS ??
      '';
    const panel =
      this.config.get<string>('ADMIN_PANEL_EMAIL') ??
      process.env.ADMIN_PANEL_EMAIL ??
      '';
    const emails = [...raw.split(','), panel]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    return new Set(emails);
  }

  /* ────────────────────────────────────────────────────────
     STATS
  ──────────────────────────────────────────────────────── */

  async getDashboardStats() {
    const [totalUsers, totalQuests, totalCompletions, totalWinners] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.quest.count(),
        this.prisma.questCompletion.count(),
        this.prisma.winnerDraw.count({ where: { distributed: true } }),
      ]);
    return { totalUsers, totalQuests, totalCompletions, totalWinners };
  }

  /* ────────────────────────────────────────────────────────
     HELPERS
  ──────────────────────────────────────────────────────── */

  private parseTags(raw: string): string[] {
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }

  /** Generate random invite codes (admin utility). */
  generateCodes(count: number, prefix = 'CQ'): string[] {
    return Array.from({ length: count }, () =>
      `${prefix}-${randomUUID().split('-')[0].toUpperCase()}`,
    );
  }
}
