import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  QuestKind,
  QuestStatus,
  RewardType,
  SubmissionStatus,
  normalizeRewardType,
} from '../common/prisma-types';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { requiresPaidInviteClaim } from '../quests/quest-reward-config';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { UsersService } from '../users/users.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { withQuestMediaUrls } from '../storage/quest-media.util';
import {
  type QuestSocialLinkInput,
  normalizeQuestSocialLinksForSave,
  parseQuestSocialLinks,
  serializeQuestSocialLinks,
} from '../quests/quest-social-links.util';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly splice: SpliceValidatorService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly storage: R2StorageService,
  ) {}

  /** Drop replaced/removed banner & logo from R2 when not referenced by another quest. */
  private async cleanupQuestMediaUrls(
    questId: string,
    previous: { bannerImageUrl: string | null; logoUrl: string | null },
    next: { bannerImageUrl?: string | null; logoUrl?: string | null },
  ): Promise<void> {
    const tasks: Array<{ field: 'bannerImageUrl' | 'logoUrl'; old: string | null; neu: string | null }> = [];

    if (next.bannerImageUrl !== undefined) {
      const neu = next.bannerImageUrl?.trim() || null;
      const old = previous.bannerImageUrl?.trim() || null;
      if (old && old !== neu) tasks.push({ field: 'bannerImageUrl', old, neu });
    }
    if (next.logoUrl !== undefined) {
      const neu = next.logoUrl?.trim() || null;
      const old = previous.logoUrl?.trim() || null;
      if (old && old !== neu) tasks.push({ field: 'logoUrl', old, neu });
    }

    for (const { field, old } of tasks) {
      const inUse = await this.prisma.quest.count({
        where: {
          id: { not: questId },
          OR: [{ bannerImageUrl: old }, { logoUrl: old }],
        },
      });
      if (inUse > 0) {
        this.logger.warn(`Skip delete ${field} asset still used by another quest: ${old}`);
        continue;
      }
      await this.storage.deleteQuestAssetByUrl(old);
    }
  }

  /* ────────────────────────────────────────────────────────
     QUEST CRUD
  ──────────────────────────────────────────────────────── */

  async listQuests(kind?: QuestKind) {
    const quests = await this.prisma.quest.findMany({
      where: kind ? { questKind: kind } : undefined,
      include: {
        tasks: { orderBy: { order: 'asc' } },
        _count: { select: { completions: true, submissions: true, inviteCodes: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const questIds = quests.map((q) => q.id);
    const unassigned =
      questIds.length > 0
        ? await this.prisma.inviteCodePool.groupBy({
            by: ['questId'],
            where: { questId: { in: questIds }, userId: null },
            _count: { _all: true },
          })
        : [];
    const codesByQuest = new Map(
      unassigned.map((r) => [r.questId, r._count._all]),
    );
    return quests.map((q) =>
      withQuestMediaUrls(
        {
          ...q,
          tags: this.parseTags(q.tags),
          socialLinks: parseQuestSocialLinks(q.socialLinks),
          codesRemaining: codesByQuest.get(q.id) ?? 0,
        },
        this.storage,
      ),
    );
  }

  async getEarnHubQuest() {
    const q = await this.prisma.quest.findFirst({
      where: { questKind: QuestKind.EARN_HUB },
      include: {
        tasks: { orderBy: { order: 'asc' } },
        _count: { select: { completions: true, submissions: true } },
      },
    });
    if (!q) return null;
    return withQuestMediaUrls(
      { ...q, tags: this.parseTags(q.tags), socialLinks: parseQuestSocialLinks(q.socialLinks) },
      this.storage,
    );
  }

  async ensureEarnHubQuest() {
    const existing = await this.getEarnHubQuest();
    if (existing) return existing;

    const quest = await this.prisma.quest.create({
      data: {
        title: 'CanQuest Earn',
        org: 'CanQuest',
        orgSlug: 'CQ',
        description:
          'Daily check-in, social tasks, and quizzes. Collect points and redeem for CC and other rewards.',
        banner: 'linear-gradient(135deg,rgba(90,217,138,0.35) 0%,rgba(17,24,39,0.9) 100%)',
        rewardCc: 0,
        rewardPool: 'Earn points',
        status: QuestStatus.ACTIVE,
        rewardType: RewardType.CC_ONLY,
        questKind: QuestKind.EARN_HUB,
        tags: JSON.stringify(['earn', 'daily']),
        tasks: {
          create: [
            {
              type: 'daily_check_in',
              title: 'Daily check-in',
              points: 10,
              order: 0,
            },
          ],
        },
      },
      include: {
        tasks: { orderBy: { order: 'asc' } },
        _count: { select: { completions: true, submissions: true } },
      },
    });
    return withQuestMediaUrls(
      {
        ...quest,
        tags: this.parseTags(quest.tags),
        socialLinks: parseQuestSocialLinks(quest.socialLinks),
      },
      this.storage,
    );
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
    return withQuestMediaUrls(
      { ...q, tags: this.parseTags(q.tags), socialLinks: parseQuestSocialLinks(q.socialLinks) },
      this.storage,
    );
  }

  private assertQuestSchedule(
    startsAt?: string | null,
    endsAt?: string | null,
  ): void {
    if (!startsAt || !endsAt) return;
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (end <= start) {
      throw new BadRequestException(
        'End date/time must be after start date/time.',
      );
    }
  }

  /** Type 4 (CC FCFS) on Earn requires slots so claim-fcfs + fee run instead of auto-send on submit. */
  private assertCcFcfsMaxWinners(
    rewardType: RewardType | string | undefined,
    maxWinners: number | null | undefined,
    questKind: QuestKind,
  ): void {
    if (questKind !== QuestKind.CAMPAIGN) return;
    if (normalizeRewardType((rewardType ?? RewardType.CC_ONLY) as RewardType) !== RewardType.CC_ONLY) {
      return;
    }
    if (maxWinners == null || maxWinners < 1) {
      throw new BadRequestException(
        'Token CC (FCFS) campaigns require Max winners / FCFS slots ≥ 1 so users claim with fee before receiving CC.',
      );
    }
  }

  async createQuest(data: {
    title: string;
    projectName?: string | null;
    org: string;
    orgSlug: string;
    description: string;
    banner?: string;
    bannerImageUrl?: string | null;
    logoUrl?: string | null;
    rewardCc?: number;
    rewardPool?: string;
    deadline?: string;
    startsAt?: string | null;
    endsAt?: string | null;
    status?: QuestStatus;
    rewardType?: RewardType;
      maxWinners?: number;
      claimFeeCc?: number | null;
      winnerMessage?: string | null;
      tags?: string[];
      socialLinks?: QuestSocialLinkInput[];
      questKind?: QuestKind;
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
    this.assertQuestSchedule(data.startsAt, data.endsAt);
    const questKind = data.questKind ?? QuestKind.CAMPAIGN;
    this.assertCcFcfsMaxWinners(data.rewardType, data.maxWinners, questKind);
    if (questKind === QuestKind.EARN_HUB) {
      const existing = await this.prisma.quest.findFirst({
        where: { questKind: QuestKind.EARN_HUB },
      });
      if (existing) {
        throw new ConflictException(
          'CanQuest Earn hub already exists. Manage it under Admin → Quest.',
        );
      }
    }
    const quest = await this.prisma.quest.create({
      data: {
        title: data.title,
        projectName: data.projectName?.trim() || null,
        org: data.org,
        orgSlug: data.orgSlug,
        description: data.description,
        banner: data.banner ?? 'linear-gradient(135deg,#1e293b,#0f172a)',
        bannerImageUrl: data.bannerImageUrl ?? null,
        logoUrl: data.logoUrl ?? null,
        rewardCc: data.rewardCc ?? 0,
        rewardPool: data.rewardPool ?? (data.rewardCc ? `${data.rewardCc} CC` : 'TBD'),
        deadline: data.deadline ?? null,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        status: data.status ?? QuestStatus.ACTIVE,
        rewardType: data.rewardType ?? RewardType.CC_ONLY,
        maxWinners: data.maxWinners ?? null,
        claimFeeCc: data.claimFeeCc ?? null,
        winnerMessage: data.winnerMessage?.trim() || null,
        questKind,
        tags: JSON.stringify(data.tags ?? []),
        socialLinks: serializeQuestSocialLinks(
          normalizeQuestSocialLinksForSave(data.socialLinks ?? []),
        ),
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
    return withQuestMediaUrls(
      {
        ...quest,
        tags: data.tags ?? [],
        socialLinks: normalizeQuestSocialLinksForSave(data.socialLinks ?? []),
      },
      this.storage,
    );
  }

  async updateQuest(
    questId: string,
    data: {
      title?: string;
      projectName?: string | null;
      org?: string;
      orgSlug?: string;
      description?: string;
      banner?: string;
      bannerImageUrl?: string | null;
      logoUrl?: string | null;
      rewardCc?: number;
      rewardPool?: string;
      deadline?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
      status?: QuestStatus;
      rewardType?: RewardType;
      maxWinners?: number | null;
      claimFeeCc?: number | null;
      winnerMessage?: string | null;
      tags?: string[];
      socialLinks?: QuestSocialLinkInput[];
    },
  ) {
    const existing = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!existing) throw new NotFoundException('Quest not found');

    const nextStarts =
      data.startsAt !== undefined
        ? data.startsAt
        : existing.startsAt?.toISOString() ?? null;
    const nextEnds =
      data.endsAt !== undefined
        ? data.endsAt
        : existing.endsAt?.toISOString() ?? null;
    this.assertQuestSchedule(nextStarts, nextEnds);
    const nextRewardType = data.rewardType ?? existing.rewardType;
    const nextMaxWinners =
      data.maxWinners !== undefined ? data.maxWinners : existing.maxWinners;
    this.assertCcFcfsMaxWinners(nextRewardType, nextMaxWinners, existing.questKind);

    await this.cleanupQuestMediaUrls(questId, existing, {
      bannerImageUrl: data.bannerImageUrl,
      logoUrl: data.logoUrl,
    });

    const updated = await this.prisma.quest.update({
      where: { id: questId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.projectName !== undefined && {
          projectName: data.projectName?.trim() || null,
        }),
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
        ...(data.startsAt !== undefined && {
          startsAt: data.startsAt ? new Date(data.startsAt) : null,
        }),
        ...(data.endsAt !== undefined && {
          endsAt: data.endsAt ? new Date(data.endsAt) : null,
        }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.rewardType !== undefined && { rewardType: data.rewardType }),
        ...(data.maxWinners !== undefined && { maxWinners: data.maxWinners }),
        ...(data.claimFeeCc !== undefined && { claimFeeCc: data.claimFeeCc }),
        ...(data.winnerMessage !== undefined && {
          winnerMessage: data.winnerMessage?.trim() || null,
        }),
        ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
        ...(data.socialLinks !== undefined && {
          socialLinks: serializeQuestSocialLinks(
            normalizeQuestSocialLinksForSave(data.socialLinks),
          ),
        }),
      },
    });
    return withQuestMediaUrls(
      {
        ...updated,
        tags: this.parseTags(updated.tags),
        socialLinks: parseQuestSocialLinks(updated.socialLinks),
      },
      this.storage,
    );
  }

  async deleteQuest(questId: string) {
    const existing = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!existing) throw new NotFoundException('Quest not found');

    await this.cleanupQuestMediaUrls(questId, existing, {
      bannerImageUrl: null,
      logoUrl: null,
    });

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
      showNewBadge?: boolean;
      repeatEvery24h?: boolean;
    },
  ) {
    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) throw new NotFoundException('Quest not found');
    const count = await this.prisma.questTask.count({ where: { questId } });
    const repeatEvery24h = data.type === 'daily_check_in';
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
        showNewBadge: data.showNewBadge ?? false,
        repeatEvery24h,
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
      showNewBadge?: boolean;
      repeatEvery24h?: boolean;
    },
  ) {
    const existing = await this.prisma.questTask.findUnique({ where: { id: taskId } });
    if (!existing) throw new NotFoundException('Task not found');
    const nextType = data.type ?? existing.type;
    const repeatEvery24h = nextType === 'daily_check_in';
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
        ...(data.showNewBadge !== undefined && { showNewBadge: data.showNewBadge }),
        repeatEvery24h,
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

  private csvEscape(v: string | number | null | undefined): string {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  }

  private csvFromRows(header: string[], dataRows: (string | number | null)[][]): string {
    const lines = [
      header.join(','),
      ...dataRows.map((row) => row.map((c) => this.csvEscape(c)).join(',')),
    ];
    return lines.join('\n');
  }

  /** Reward-type CSV export for admin download. */
  async exportQuestActivity(questId: string) {
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: { tasks: { orderBy: { order: 'asc' } } },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    const rewardType = normalizeRewardType(quest.rewardType as RewardType);

    const submissions = await this.prisma.questSubmission.findMany({
      where: { questId, status: SubmissionStatus.VERIFIED },
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
        task: { select: { type: true, title: true } },
      },
    });

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
      orderBy: { completedAt: 'asc' },
    });

    const winners = await this.prisma.winnerDraw.findMany({
      where: { questId },
      include: {
        user: {
          select: {
            email: true,
            username: true,
            displayName: true,
            cantonPartyId: true,
          },
        },
      },
    });

    const proofByUserTask = new Map<string, string>();
    for (const s of submissions) {
      if (s.proof) proofByUserTask.set(`${s.userId}:${s.task.type}`, s.proof);
    }

    let csv: string;
    let exportKind: string;
    let filename: string;

    if (rewardType === RewardType.WAITLIST_EMAIL) {
      exportKind = 'waitlist';
      filename = `quest-${questId}-waitlist.csv`;
      const header = [
        'email',
        'username',
        'displayName',
        'emailFromTask',
        'cantonPartyId',
        'completedAt',
      ];
      const rows = completions.map((c) => [
        c.user.email,
        c.user.username,
        c.user.displayName,
        proofByUserTask.get(`${c.userId}:submit_email`) ?? '',
        c.user.cantonPartyId,
        c.completedAt.toISOString(),
      ]);
      csv = this.csvFromRows(header, rows);
    } else if (
      rewardType === RewardType.CC_ONLY ||
      rewardType === RewardType.CC_MANUAL ||
      rewardType === RewardType.CC_AND_INVITE
    ) {
      exportKind = 'cc_participants';
      filename = `quest-${questId}-cc-participants.csv`;
      const header = [
        'email',
        'username',
        'displayName',
        'cantonPartyId',
        'partyIdFromTask',
        'rewardCc',
        'completedAt',
      ];
      const rows = completions.map((c) => [
        c.user.email,
        c.user.username,
        c.user.displayName,
        c.user.cantonPartyId,
        proofByUserTask.get(`${c.userId}:submit_party_id`) ??
          proofByUserTask.get(`${c.userId}:submit_canton_address`) ??
          '',
        String(Number(c.rewardMicroCc) / 1_000_000),
        c.completedAt.toISOString(),
      ]);
      csv = this.csvFromRows(header, rows);
    } else if (
      rewardType === RewardType.INVITE_CODE_RANDOM ||
      rewardType === RewardType.INVITE_CODE
    ) {
      exportKind = 'invite_draw';
      filename = `quest-${questId}-invite-results.csv`;
      const drawnIds = new Set(winners.map((w) => w.userId));
      const header = [
        'email',
        'username',
        'displayName',
        'cantonPartyId',
        'isWinner',
        'inviteCode',
        'drawnAt',
        'completedAt',
      ];
      const winnerRows = winners.map((w) => [
        w.user.email,
        w.user.username,
        w.user.displayName,
        w.user.cantonPartyId,
        'yes',
        w.inviteCode,
        w.drawnAt.toISOString(),
        '',
      ]);
      const loserRows = completions
        .filter((c) => !drawnIds.has(c.userId))
        .map((c) => [
          c.user.email,
          c.user.username,
          c.user.displayName,
          c.user.cantonPartyId,
          'no',
          '',
          '',
          c.completedAt.toISOString(),
        ]);
      csv = this.csvFromRows(header, [...winnerRows, ...loserRows]);
    } else {
      exportKind = 'activity';
      filename = `quest-${questId}-activity.csv`;
      const header = [
        'email',
        'username',
        'displayName',
        'cantonPartyId',
        'taskType',
        'taskTitle',
        'proof',
        'completedAt',
      ];
      const rows = submissions.map((s) => {
        const completed = completions.find((c) => c.userId === s.userId);
        return [
          s.user.email,
          s.user.username,
          s.user.displayName,
          s.user.cantonPartyId,
          s.task.type,
          s.task.title,
          s.proof,
          completed?.completedAt.toISOString() ?? '',
        ];
      });
      csv = this.csvFromRows(header, rows);
    }

    return {
      quest: {
        id: quest.id,
        title: quest.title,
        rewardType,
        status: quest.status,
      },
      exportKind,
      filename,
      submissionCount: submissions.length,
      completionCount: completions.length,
      winnerCount: winners.length,
      csv,
    };
  }

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

    const rewardType = normalizeRewardType(quest.rewardType as RewardType);
    if (
      rewardType === RewardType.INVITE_CODE_RANDOM ||
      rewardType === RewardType.INVITE_CODE
    ) {
      const codeCount = await this.prisma.inviteCodePool.count({
        where: { questId, userId: null },
      });
      if (codeCount === 0) {
        throw new BadRequestException(
          'Add invite codes on the Winners page before running a draw.',
        );
      }
    }

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
      rewardType === RewardType.INVITE_CODE_RANDOM ||
      rewardType === RewardType.INVITE_CODE ||
      rewardType === RewardType.CC_AND_INVITE;

    const deferCodeAssignment = requiresPaidInviteClaim(quest);

    const availableCodes =
      needCodes && !deferCodeAssignment
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
      const code = deferCodeAssignment ? null : (availableCodes[i] ?? null);

      const existing = await this.prisma.winnerDraw.findUnique({
        where: { questId_userId: { questId, userId: uid } },
      });
      if (existing) continue;

      if (code) {
        await this.prisma.inviteCodePool.update({
          where: { id: code.id },
          data: { userId: uid, assignedAt: new Date() },
        });
      }

      await this.prisma.winnerDraw.create({
        data: {
          questId,
          userId: uid,
          ccAmount: quest.rewardCc,
          inviteCode: code?.code ?? null,
          distributed: false,
        },
      });

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
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      select: { rewardType: true },
    });
    if (quest) {
      const rt = normalizeRewardType(quest.rewardType as RewardType);
      if (
        rt === RewardType.CC_MANUAL ||
        rt === RewardType.INVITE_CODE_RANDOM ||
        rt === RewardType.INVITE_CODE ||
        rt === RewardType.WAITLIST_EMAIL
      ) {
        throw new BadRequestException(
          'Raffle campaigns: use Draw Winners only — winners claim or view results on the quest page.',
        );
      }
    }

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
          const quest = await this.prisma.quest.findUnique({
            where: { id: questId },
            select: { title: true },
          });
          const rewardLabel = quest?.title ?? 'Quest';
          const offerContractId = await this.splice.createTransferOffer(
            user.cantonPartyId,
            draw.ccAmount,
            rewardLabel,
          );
          if (offerContractId && user.username) {
            ccSent = await this.splice.acceptOfferViaWallet(
              offerContractId,
              user.username,
            );
            if (ccSent) {
              ledgerTxId = offerContractId;
              await this.users.recordTransaction({
                userId: user.id,
                amountCc: draw.ccAmount,
                type: 'QUEST_REWARD',
                description: rewardLabel,
                referenceId: questId,
                ledgerTxId: offerContractId,
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

  async deleteInviteCode(questId: string, codeId: string) {
    const row = await this.prisma.inviteCodePool.findFirst({
      where: { id: codeId, questId },
    });
    if (!row) throw new NotFoundException('Invite code not found');
    if (row.userId) {
      throw new BadRequestException(
        'This code is already assigned to a user and cannot be deleted.',
      );
    }
    await this.prisma.inviteCodePool.delete({ where: { id: codeId } });
    return { ok: true, deleted: 1, code: row.code };
  }

  /** Remove unassigned codes so admin can re-upload. Assigned codes are kept. */
  async deleteInviteCodes(questId: string) {
    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) throw new NotFoundException('Quest not found');

    const skippedAssigned = await this.prisma.inviteCodePool.count({
      where: { questId, userId: { not: null } },
    });

    const result = await this.prisma.inviteCodePool.deleteMany({
      where: { questId, userId: null },
    });

    return {
      ok: true,
      deleted: result.count,
      skippedAssigned,
    };
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
    const [
      totalUsers,
      campaignQuests,
      earnHub,
      totalCompletions,
      totalWinners,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.quest.count({ where: { questKind: QuestKind.CAMPAIGN } }),
      this.prisma.quest.findFirst({
        where: { questKind: QuestKind.EARN_HUB },
        include: { _count: { select: { tasks: true, submissions: true } } },
      }),
      this.prisma.questCompletion.count(),
      this.prisma.winnerDraw.count({ where: { distributed: true } }),
    ]);
    return {
      totalUsers,
      totalQuests: campaignQuests,
      totalCompletions,
      totalWinners,
      campaignQuests,
      earnHubConfigured: !!earnHub,
      earnHubTaskCount: earnHub?._count.tasks ?? 0,
      earnHubSubmissions: earnHub?._count.submissions ?? 0,
    };
  }

  /* ────────────────────────────────────────────────────────
     WALLET INVITE CODES (wallet creation gate)
  ──────────────────────────────────────────────────────── */

  async listWalletInviteCodes() {
    const codes = await this.prisma.walletInviteCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        redeemedBy: {
          select: { id: true, email: true, username: true },
        },
      },
    });
    const available = codes.filter((c) => !c.redeemedAt).length;
    return {
      total: codes.length,
      available,
      used: codes.length - available,
      codes: codes.map((c) => ({
        id: c.id,
        code: c.code,
        note: c.note,
        createdAt: c.createdAt.toISOString(),
        redeemedAt: c.redeemedAt?.toISOString() ?? null,
        reservedAt: c.reservedAt?.toISOString() ?? null,
        reservedById: c.reservedById,
        redeemedBy: c.redeemedBy
          ? {
              id: c.redeemedBy.id,
              email: c.redeemedBy.email,
              username: c.redeemedBy.username,
            }
          : null,
      })),
    };
  }

  async generateWalletInviteCodes(params: {
    count?: number;
    codes?: string[];
    note?: string;
  }) {
    const note = params.note?.trim() || null;
    const rawList =
      params.codes?.map((c) => c.trim().toUpperCase()).filter(Boolean) ??
      this.generateCodes(Math.min(Math.max(params.count ?? 1, 1), 500), 'WQ');

    const created: string[] = [];
    const skipped: string[] = [];

    for (const code of rawList) {
      try {
        await this.prisma.walletInviteCode.create({
          data: { code, note },
        });
        created.push(code);
      } catch {
        skipped.push(code);
      }
    }

    return { created: created.length, skipped: skipped.length, codes: created };
  }

  async deleteWalletInviteCode(id: string) {
    const row = await this.prisma.walletInviteCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Wallet invite code not found');
    if (row.redeemedAt) {
      throw new BadRequestException('Cannot delete a code that has already been used.');
    }
    await this.prisma.walletInviteCode.delete({ where: { id } });
    return { ok: true };
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
