import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  QuestKind,
  QuestStatus,
  RewardType,
  SubmissionStatus,
  normalizeRewardType,
  resolveQuestDisplayStatus,
} from '../common/prisma-types';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  QuestLedgerService,
  type QuestLedgerSubmitResult,
} from '../canton/quest-ledger.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { ProfileAvatarService } from '../users/profile-avatar.service';
import { resolvePublicAvatarUrl } from '../users/user-avatar-url';
import { UsersService } from '../users/users.service';
import { TwitterApiService } from '../twitter/twitter-api.service';

export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  cantonPartyId: string | null;
  points: number;
  avatarUrl: string | null;
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

/** Shown to users when FCFS claim cannot complete (slots, balance, ledger). */
const FCFS_CLAIM_FAIL_MSG =
  'Claim failed: Transaction reverted by ledger (Slot is full or insufficient balance)';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class QuestsService {
  private readonly logger = new Logger(QuestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly questLedger: QuestLedgerService,
    private readonly avatars: ProfileAvatarService,
    private readonly users: UsersService,
    private readonly twitterApi: TwitterApiService,
    private readonly splice: SpliceValidatorService,
    private readonly config: ConfigService,
  ) {}

  /** CC FCFS: user pays claim fee on-chain, then receives quest.rewardCc from validator pool. */
  requiresFcfsCcClaim(quest: {
    rewardType: RewardType | string;
    maxWinners: number | null;
  }): boolean {
    return (
      normalizeRewardType(quest.rewardType as RewardType) === RewardType.CC_ONLY &&
      (quest.maxWinners ?? 0) > 0
    );
  }

  isCampaignEnded(quest: {
    endsAt: Date | null;
    deadline?: Date | string | null;
  }): boolean {
    const raw = quest.endsAt ?? quest.deadline ?? null;
    if (!raw) return false;
    const end = raw instanceof Date ? raw : new Date(raw);
    return !Number.isNaN(end.getTime()) && end < new Date();
  }

  async getCampaignMeta(questId: string) {
    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) {
      return {
        ended: false,
        endsAt: null as string | null,
        remainingSlots: null as number | null,
        maxWinners: null as number | null,
        fcfsClaimFeeCc: Number(this.config.get<string>('FCFS_CLAIM_FEE_CC') ?? '3'),
        requiresFcfsClaim: false,
      };
    }
    const maxWinners = quest.maxWinners;
    let remainingSlots: number | null = null;
    if (maxWinners != null && maxWinners > 0) {
      await this.releaseStaleFcfsReservations(questId);
      const used = await this.countFcfsSlotsTaken(questId);
      remainingSlots = this.fcfsSlotsRemaining(maxWinners, used);
    }
    const endRaw = quest.endsAt ?? quest.deadline ?? null;
    const end =
      endRaw instanceof Date
        ? endRaw
        : endRaw
          ? new Date(endRaw)
          : null;
    return {
      ended: this.isCampaignEnded(quest),
      endsAt: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
      remainingSlots,
      maxWinners,
      fcfsClaimFeeCc: Number(this.config.get<string>('FCFS_CLAIM_FEE_CC') ?? '3'),
      requiresFcfsClaim: this.requiresFcfsCcClaim(quest),
    };
  }

  private fcfsReservationTtlMs(): number {
    return Number(this.config.get<string>('FCFS_RESERVATION_TTL_MS') ?? '300000');
  }

  private fcfsSlotsRemaining(maxWinners: number, taken: number): number {
    return Math.max(0, maxWinners - taken);
  }

  /** Drop abandoned reservations so slots are not blocked after crashes/timeouts. */
  private async releaseStaleFcfsReservations(
    questId: string,
    tx: PrismaTx | PrismaService = this.prisma,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - this.fcfsReservationTtlMs());
    const result = await tx.winnerDraw.deleteMany({
      where: { questId, distributed: false, drawnAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(
        `FCFS: cleared ${result.count} stale reservation(s) for quest ${questId.slice(0, 8)}`,
      );
    }
  }

  private countFcfsSlotsTaken(questId: string, tx: PrismaTx | PrismaService = this.prisma) {
    return tx.winnerDraw.count({ where: { questId } });
  }

  /**
   * Atomically reserve one FCFS slot (row lock on Quest + slot count).
   * Prevents two users from taking the last slot at the same time.
   */
  private async reserveFcfsSlotLocked(params: {
    questId: string;
    userId: string;
    rewardCc: number;
    maxWinners: number;
  }): Promise<
    | { kind: 'already_claimed' }
    | { kind: 'reserved'; drawId: string; isNewReservation: boolean }
  > {
    const { questId, userId, rewardCc, maxWinners } = params;

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Quest" WHERE id = ${questId} FOR UPDATE`;

      await this.releaseStaleFcfsReservations(questId, tx);

      const existing = await tx.winnerDraw.findUnique({
        where: { questId_userId: { questId, userId } },
      });
      if (existing?.distributed) {
        return { kind: 'already_claimed' as const };
      }
      if (existing && !existing.distributed) {
        return {
          kind: 'reserved' as const,
          drawId: existing.id,
          isNewReservation: false,
        };
      }

      const taken = await this.countFcfsSlotsTaken(questId, tx);
      if (taken >= maxWinners) {
        throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
      }

      const row = await tx.winnerDraw.create({
        data: {
          questId,
          userId,
          ccAmount: rewardCc,
          distributed: false,
        },
      });
      return {
        kind: 'reserved' as const,
        drawId: row.id,
        isNewReservation: true,
      };
    });
  }

  /* ─── Quest list / detail ─── */

  async listQuests(status?: QuestStatus) {
    const quests = await this.prisma.quest.findMany({
      where: { questKind: QuestKind.CAMPAIGN },
      include: { tasks: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const mapped = quests.map((q) => ({
      ...q,
      tags: this.parseTags(q.tags),
      rewardType: normalizeRewardType(q.rewardType as RewardType),
      status: resolveQuestDisplayStatus(q),
    }));
    return status ? mapped.filter((q) => q.status === status) : mapped;
  }

  async getEarnHubQuest() {
    const q = await this.prisma.quest.findFirst({
      where: { questKind: QuestKind.EARN_HUB },
      include: { tasks: { orderBy: { order: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!q) return null;
    return {
      ...q,
      tags: this.parseTags(q.tags),
      rewardType: normalizeRewardType(q.rewardType as RewardType),
      status: resolveQuestDisplayStatus(q),
    };
  }

  /** Landing page — active & upcoming quests, newest first (no auth). */
  async listFeaturedQuests(limit = 20) {
    const take = Math.min(30, Math.max(1, limit));
    const all = await this.listQuests();
    return all
      .filter(
        (q) =>
          q.status === QuestStatus.ACTIVE ||
          q.status === QuestStatus.COMING_SOON,
      )
      .slice(0, take);
  }

  /** Quest campaign title for wallet / transaction labels */
  async getQuestTitle(questId: string): Promise<string> {
    const q = await this.prisma.quest.findUnique({
      where: { id: questId },
      select: { title: true },
    });
    return q?.title ?? 'Quest';
  }

  /** Batch resolve project names for transaction enrichment */
  async getQuestTitlesByIds(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const quests = await this.prisma.quest.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    return Object.fromEntries(quests.map((q) => [q.id, q.title]));
  }

  async getQuest(questId: string) {
    const q = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: { tasks: { orderBy: { order: 'asc' } } },
    });
    if (!q) throw new NotFoundException('Quest not found');
    return {
      ...q,
      tags: this.parseTags(q.tags),
      rewardType: normalizeRewardType(q.rewardType as RewardType),
    };
  }

  /* ─── User progress ─── */

  async getUserProgress(userId: string, questId: string) {
    const [completion, submissions, rewardStatus] = await Promise.all([
      this.prisma.questCompletion.findUnique({
        where: { userId_questId: { userId, questId } },
      }),
      this.prisma.questSubmission.findMany({
        where: { userId, questId },
        include: { task: true },
      }),
      this.getQuestRewardStatus(userId, questId),
    ]);
    const completed = !!completion;
    const allTasksVerified = await this.areAllTasksVerified(userId, questId);
    const campaignMeta = await this.getCampaignMeta(questId);
    return {
      completed,
      allTasksVerified,
      submissions,
      rewardStatus,
      rewardCc: completion ? Number(completion.rewardMicroCc) / 1_000_000 : 0,
      cantonLedgerConfigured: this.questLedger.isConfigured(),
      ledger: completion ? this.ledgerFromCompletion(completion) : null,
      campaignMeta,
    };
  }

  /** Map stored completion row → API ledger proof (survives page reload). */
  private ledgerFromCompletion(completion: {
    ledgerParticipationId: string | null;
    ledgerRewardId: string | null;
    ledgerTaskSubmissionIds: unknown;
  }): QuestLedgerSubmitResult {
    const taskSubmissionIds = this.parseLedgerTaskIds(completion.ledgerTaskSubmissionIds);
    const hasOnChain =
      !!completion.ledgerParticipationId || taskSubmissionIds.length > 0;
    return {
      ledgerEnabled: this.questLedger.isConfigured() && hasOnChain,
      participationContractId: completion.ledgerParticipationId,
      rewardContractId: completion.ledgerRewardId,
      taskSubmissionIds,
      errors: [],
    };
  }

  private parseLedgerTaskIds(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
    }
    return [];
  }

  /** Shape expected by web `QuestLedgerProof`. */
  toApiLedgerProof(
    ledger: QuestLedgerSubmitResult | null,
    rewardCc = 0,
    cip56Queued?: boolean,
  ): {
    enabled: boolean;
    participationContractId: string | null;
    rewardContractId: string | null;
    taskSubmissionCount: number;
    cip56Queued: boolean;
    errors: string[];
  } | null {
    if (!ledger) return null;
    return {
      enabled: ledger.ledgerEnabled,
      participationContractId: ledger.participationContractId,
      rewardContractId: ledger.rewardContractId,
      taskSubmissionCount: ledger.taskSubmissionIds.length,
      cip56Queued: cip56Queued ?? rewardCc > 0,
      errors: ledger.errors,
    };
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
    const { userId, userPartyId, questId, taskId } = params;
    let { proof } = params;

    const task = await this.prisma.questTask.findFirst({
      where: { id: taskId, questId },
    });
    if (!task) throw new NotFoundException('Task not found in this quest');

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      select: { questKind: true, endsAt: true, deadline: true },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    if (
      quest.questKind === QuestKind.CAMPAIGN &&
      this.isCampaignEnded(quest)
    ) {
      throw new BadRequestException('This campaign has ended. Submissions are closed.');
    }

    const taskType = this.normalizeTaskType(task.type);
    const repeatable24h =
      quest.questKind === QuestKind.EARN_HUB && taskType === 'daily_check_in';

    const existing = await this.prisma.questSubmission.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (existing) {
      if (existing.status === SubmissionStatus.VERIFIED) {
        if (repeatable24h) {
          const lastAt = existing.verifiedAt ?? existing.submittedAt;
          const elapsed = Date.now() - lastAt.getTime();
          const cooldownMs = 24 * 60 * 60 * 1000;
          if (elapsed < cooldownMs) {
            const hoursLeft = Math.max(
              1,
              Math.ceil((cooldownMs - elapsed) / (60 * 60 * 1000)),
            );
            throw new BadRequestException(
              `Come back in ~${hoursLeft} hour(s) to earn points again.`,
            );
          }
          const now = new Date();
          await this.prisma.questSubmission.update({
            where: { id: existing.id },
            data: {
              proof: proof?.trim() || 'checked_in',
              verifiedAt: now,
              submittedAt: now,
            },
          });
          await this.users.creditEarnPoints(userId, task.points);
          this.logger.log(
            `Task re-submitted (24h repeat): user=${userId.slice(0, 8)} task=${taskId}`,
          );
          return { status: SubmissionStatus.VERIFIED, alreadyDone: false };
        }
        return { status: SubmissionStatus.VERIFIED, alreadyDone: true };
      }
      throw new ConflictException('Task already submitted and pending review');
    }
    const isEarnHubQuiz =
      quest.questKind === QuestKind.EARN_HUB &&
      (taskType === 'quiz_yes_no' || taskType === 'quiz_choice');
    if (isEarnHubQuiz && task.createdAt) {
      const ageMs = Date.now() - task.createdAt.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        throw new BadRequestException(
          'This quiz has ended. Points are only available within 24 hours of publish.',
        );
      }
    }
    if (
      (taskType === 'submit_party_id' || taskType === 'submit_canton_address') &&
      !proof?.trim() &&
      userPartyId
    ) {
      proof = userPartyId;
    }

    // Quizzes: wrong answer = no submission (user can try again)
    if (taskType === 'quiz_yes_no' || taskType === 'quiz_choice') {
      if (!proof?.trim()) {
        throw new BadRequestException('Please select an answer.');
      }
      if (!this.canAutoVerify(taskType, task.correctAnswer, proof)) {
        throw new BadRequestException('Incorrect answer. No points awarded — try again.');
      }
    }

    if (taskType === 'twitter_follow' || taskType === 'twitter_retweet') {
      await this.verifyTwitterTaskForUser(userId, taskType, task.target);
    }

    // Auto-verify logic by task type
    const autoVerify =
      taskType === 'twitter_follow' || taskType === 'twitter_retweet'
        ? true
        : this.canAutoVerify(taskType, task.correctAnswer, proof);

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

    if (autoVerify) {
      await this.users.creditEarnPoints(userId, task.points);
    }

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

    const completionBonus = Math.round(quest.rewardCc * 10);
    if (completionBonus > 0) {
      await this.users.creditEarnPoints(userId, completionBonus);
    }

    this.logger.log(
      `Quest completed: user=${userId.slice(0, 8)} quest=${questId} reward=${quest.rewardCc} CC`,
    );

    return { justCompleted: true, rewardMicroCc };
  }

  /** All tasks verified but quest not yet submitted to Canton / rewards. */
  async areAllTasksVerified(userId: string, questId: string): Promise<boolean> {
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: { tasks: true },
    });
    if (!quest || quest.tasks.length === 0) return false;
    const verified = await this.prisma.questSubmission.findMany({
      where: { userId, questId, status: SubmissionStatus.VERIFIED },
    });
    return quest.tasks.every((t) => verified.some((s) => s.taskId === t.id));
  }

  /**
   * Final quest submit: DAML audit trail + reward routing (CIP-56 CC, FCFS invite, waitlist).
   */
  async submitQuest(params: {
    userId: string;
    userPartyId: string | null;
    username: string | null;
    questId: string;
  }): Promise<{
    ok: boolean;
    message: string;
    rewardCc: number;
    inviteCode: string | null;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
    ledger: Awaited<ReturnType<QuestLedgerService['recordQuestCompletion']>>;
  }> {
    const { userId, questId, userPartyId, username } = params;

    const existing = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (existing) {
      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      return {
        ok: true,
        message: 'Quest already submitted',
        rewardCc: Number(existing.rewardMicroCc) / 1_000_000,
        inviteCode: rewardStatus.inviteCode,
        rewardStatus,
        ledger: this.ledgerFromCompletion(existing),
      };
    }

    const allDone = await this.areAllTasksVerified(userId, questId);
    if (!allDone) {
      return {
        ok: false,
        message: 'Complete all tasks before submitting the quest',
        rewardCc: 0,
        inviteCode: null,
        rewardStatus: await this.getQuestRewardStatus(userId, questId),
        ledger: {
          ledgerEnabled: false,
          participationContractId: null,
          rewardContractId: null,
          taskSubmissionIds: [],
          errors: ['Tasks incomplete'],
        },
      };
    }

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: { tasks: true },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    if (this.requiresFcfsCcClaim(quest)) {
      const allDone = await this.areAllTasksVerified(userId, questId);
      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      return {
        ok: false,
        message: allDone
          ? 'Use the Claim reward button to receive your FCFS CC (claim fee applies on-chain).'
          : 'Complete all tasks before claiming your FCFS reward.',
        rewardCc: 0,
        inviteCode: null,
        rewardStatus,
        ledger: {
          ledgerEnabled: false,
          participationContractId: null,
          rewardContractId: null,
          taskSubmissionIds: [],
          errors: [],
        },
      };
    }

    const now = new Date();
    if (quest.startsAt && quest.startsAt > now) {
      return {
        ok: false,
        message: 'Quest has not started yet',
        rewardCc: 0,
        inviteCode: null,
        rewardStatus: await this.getQuestRewardStatus(userId, questId),
        ledger: {
          ledgerEnabled: false,
          participationContractId: null,
          rewardContractId: null,
          taskSubmissionIds: [],
          errors: [],
        },
      };
    }
    if (quest.endsAt && quest.endsAt < now) {
      return {
        ok: false,
        message: 'Quest has ended',
        rewardCc: 0,
        inviteCode: null,
        rewardStatus: await this.getQuestRewardStatus(userId, questId),
        ledger: {
          ledgerEnabled: false,
          participationContractId: null,
          rewardContractId: null,
          taskSubmissionIds: [],
          errors: [],
        },
      };
    }

    const submissions = await this.prisma.questSubmission.findMany({
      where: { userId, questId, status: SubmissionStatus.VERIFIED },
    });

    const rewardType = normalizeRewardType(quest.rewardType as RewardType);
    let rewardCc = 0;
    if (rewardType === RewardType.CC_ONLY || rewardType === RewardType.CC_AND_INVITE) {
      rewardCc = quest.rewardCc;
    }

    let inviteCode: string | null = null;
    const needsInvite =
      rewardType === RewardType.INVITE_CODE_FCFS ||
      rewardType === RewardType.CC_AND_INVITE;

    if (needsInvite && quest.maxWinners) {
      const slotsUsed = await this.prisma.winnerDraw.count({ where: { questId } });
      if (slotsUsed < quest.maxWinners) {
        const code = await this.prisma.inviteCodePool.findFirst({
          where: { questId, userId: null },
          orderBy: { createdAt: 'asc' },
        });
        if (code) {
          inviteCode = code.code;
          await this.prisma.$transaction([
            this.prisma.inviteCodePool.update({
              where: { id: code.id },
              data: { userId, assignedAt: new Date() },
            }),
            this.prisma.winnerDraw.upsert({
              where: { questId_userId: { questId, userId } },
              create: {
                questId,
                userId,
                ccAmount: rewardCc,
                inviteCode: code.code,
                distributed: true,
              },
              update: { inviteCode: code.code },
            }),
          ]);
        }
      }
    }

    let ledgerResult: Awaited<ReturnType<QuestLedgerService['recordQuestCompletion']>> = {
      ledgerEnabled: false,
      participationContractId: null,
      rewardContractId: null,
      taskSubmissionIds: [],
      errors: [],
    };

    if (userPartyId) {
      ledgerResult = await this.questLedger.recordQuestCompletion({
        questId,
        questTitle: quest.title,
        rewardCc,
        userPartyId,
        taskIds: quest.tasks.map((t) => t.id),
        proofs: submissions.map((s) => ({ taskId: s.taskId, proof: s.proof })),
      });
    }

    const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
    await this.prisma.questCompletion.create({
      data: {
        userId,
        questId,
        rewardMicroCc,
        ledgerParticipationId: ledgerResult.participationContractId,
        ledgerRewardId: ledgerResult.rewardContractId,
        ledgerTaskSubmissionIds: ledgerResult.taskSubmissionIds,
      },
    });

    const rewardStatus = await this.getQuestRewardStatus(userId, questId);

    return {
      ok: true,
      message: 'Quest submitted successfully',
      rewardCc,
      inviteCode,
      rewardStatus,
      ledger: ledgerResult,
    };
  }

  /** User-facing winner / waitlist / FCFS status for a quest */
  async getQuestRewardStatus(userId: string, questId: string) {
    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) {
      return {
        state: 'unknown' as const,
        inviteCode: null as string | null,
        message: 'Quest not found',
      };
    }

    const rewardType = normalizeRewardType(quest.rewardType as RewardType);
    const completion = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    const draw = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });

    if (!completion) {
      return {
        state: 'in_progress' as const,
        inviteCode: null,
        message: 'Complete all tasks, then submit your quest',
      };
    }

    if (rewardType === RewardType.WAITLIST_EMAIL) {
      return {
        state: 'waitlist' as const,
        inviteCode: null,
        message: 'You are on the waitlist. We will contact you by email.',
      };
    }

    if (
      rewardType === RewardType.INVITE_CODE_FCFS ||
      (rewardType === RewardType.CC_AND_INVITE && draw?.inviteCode)
    ) {
      if (draw?.inviteCode) {
        const ccPart =
          rewardType === RewardType.CC_AND_INVITE && quest.rewardCc > 0
            ? ` Congrats! You received ${quest.rewardCc} CC.`
            : '';
        return {
          state: 'winner_fcfs' as const,
          inviteCode: draw.inviteCode,
          message:
            rewardType === RewardType.CC_AND_INVITE && quest.rewardCc > 0
              ? `Code : ${draw.inviteCode}${ccPart}`
              : `You received an invite code: ${draw.inviteCode}`,
        };
      }
      return {
        state: 'fcfs_missed' as const,
        inviteCode: null,
        message: 'All invite slots were filled before you submitted.',
      };
    }

    if (
      rewardType === RewardType.INVITE_CODE_RANDOM ||
      rewardType === RewardType.INVITE_CODE
    ) {
      if (draw?.inviteCode) {
        return {
          state: 'winner' as const,
          inviteCode: draw.inviteCode,
          message: `Congratulations! Your invite code: ${draw.inviteCode}`,
        };
      }
      const drawsHeld = await this.prisma.winnerDraw.count({ where: { questId } });
      if (drawsHeld > 0) {
        return {
          state: 'not_winner' as const,
          inviteCode: null,
          message:
            'The random draw has been completed. You were not selected this time.',
        };
      }
      return {
        state: 'pending_draw' as const,
        inviteCode: null,
        message:
          'Quest submitted. You will see your invite code here if you are selected in the admin draw.',
      };
    }

    if (this.requiresFcfsCcClaim(quest)) {
      const allDone = await this.areAllTasksVerified(userId, questId);
      if (!allDone) {
        return {
          state: 'in_progress' as const,
          inviteCode: null,
          message: 'Complete all missions, then claim your FCFS reward.',
        };
      }
      if (draw?.distributed) {
        return {
          state: 'cc_reward' as const,
          inviteCode: null,
          message:
            quest.rewardCc > 0
              ? `${quest.rewardCc} CC was sent to your wallet.`
              : 'FCFS claim completed.',
        };
      }
      await this.releaseStaleFcfsReservations(questId);
      const slotsUsed = await this.countFcfsSlotsTaken(questId);
      const maxW = quest.maxWinners ?? 0;
      const remaining = this.fcfsSlotsRemaining(maxW, slotsUsed);
      if (remaining <= 0) {
        return {
          state: 'fcfs_missed' as const,
          inviteCode: null,
          message: 'All FCFS slots were claimed. Better luck on the next campaign.',
        };
      }
      return {
        state: 'fcfs_claimable' as const,
        inviteCode: null,
        message: `${remaining} slot(s) left — claim now (${this.config.get('FCFS_CLAIM_FEE_CC') ?? '3'} CC fee).`,
      };
    }

    if (rewardType === RewardType.CC_ONLY) {
      return {
        state: 'cc_reward' as const,
        inviteCode: null,
        message:
          quest.rewardCc > 0
            ? `${quest.rewardCc} CC will be sent manually by the team (bulk sender).`
            : 'Quest recorded. CC distribution is handled by admin.',
      };
    }

    return {
      state: 'completed' as const,
      inviteCode: draw?.inviteCode ?? null,
      message: 'Quest completed.',
    };
  }

  /**
   * FCFS CC claim — reserve slot in DB, charge claim fee, send reward CC (Splice CIP-56).
   * Rolls back the slot reservation if on-chain steps fail.
   */
  async claimFcfsReward(params: {
    userId: string;
    username: string | null;
    cantonPartyId: string | null;
    questId: string;
  }): Promise<{
    ok: boolean;
    message: string;
    rewardCc: number;
    feeCc: number;
    remainingSlots: number;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
  }> {
    const { userId, questId, username, cantonPartyId } = params;
    if (!username?.trim() || !cantonPartyId?.trim()) {
      throw new BadRequestException('Create your Canton wallet before claiming.');
    }

    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) throw new NotFoundException('Quest not found');
    if (!this.requiresFcfsCcClaim(quest)) {
      throw new BadRequestException('This campaign does not use FCFS CC claim.');
    }
    if (this.isCampaignEnded(quest)) {
      throw new BadRequestException('This campaign has ended.');
    }

    const allDone = await this.areAllTasksVerified(userId, questId);
    if (!allDone) {
      throw new BadRequestException('Complete all missions before claiming.');
    }

    const feeCc = Number(this.config.get<string>('FCFS_CLAIM_FEE_CC') ?? '3');
    const rewardCc = quest.rewardCc;
    const maxWinners = quest.maxWinners ?? 0;

    let reserveResult: Awaited<ReturnType<QuestsService['reserveFcfsSlotLocked']>>;
    try {
      reserveResult = await this.reserveFcfsSlotLocked({
        questId,
        userId,
        rewardCc,
        maxWinners,
      });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
    }

    if (reserveResult.kind === 'already_claimed') {
      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      await this.releaseStaleFcfsReservations(questId);
      const taken = await this.countFcfsSlotsTaken(questId);
      return {
        ok: true,
        message: 'You already claimed this FCFS reward.',
        rewardCc,
        feeCc,
        remainingSlots: this.fcfsSlotsRemaining(maxWinners, taken),
        rewardStatus,
      };
    }

    const reservedDrawId = reserveResult.drawId;
    const isNewReservation = reserveResult.isNewReservation;

    const balance = await this.splice.getUserBalance(username);
    if (balance !== null && balance < feeCc) {
      if (isNewReservation) {
        await this.prisma.winnerDraw.delete({ where: { id: reservedDrawId } }).catch(() => {});
      }
      throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
    }

    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (!validatorPartyId) {
      if (isNewReservation) {
        await this.prisma.winnerDraw.delete({ where: { id: reservedDrawId } }).catch(() => {});
      }
      throw new BadRequestException('Validator party is not configured on the server.');
    }

    try {
      const feeOfferId = await this.splice.createTransferOffer(
        validatorPartyId,
        feeCc,
        `FCFS claim fee — ${quest.title}`,
        undefined,
        username,
      );
      if (!feeOfferId) {
        throw new Error('fee offer failed');
      }
      const feeAccepted = await this.splice.acceptOfferViaWallet(feeOfferId, username);
      if (!feeAccepted) {
        throw new Error('fee accept failed');
      }

      await this.users.recordTransaction({
        userId,
        amountCc: -feeCc,
        type: 'TRANSFER_OUT',
        description: `FCFS claim fee — ${quest.title}`,
        counterparty: 'Validator (FCFS fee)',
        ledgerTxId: feeOfferId,
      });

      const rewardOfferId = await this.splice.createTransferOffer(
        cantonPartyId,
        rewardCc,
        `FCFS reward — ${quest.title}`,
      );
      if (!rewardOfferId) {
        throw new Error('reward offer failed');
      }
      const rewardAccepted = await this.splice.acceptOfferViaWallet(
        rewardOfferId,
        username,
      );
      if (!rewardAccepted) {
        throw new Error('reward accept failed');
      }

      await this.users.recordTransaction({
        userId,
        amountCc: rewardCc,
        type: 'QUEST_REWARD',
        description: `FCFS reward — ${quest.title}`,
        counterparty: 'Validator (reward pool)',
        ledgerTxId: rewardOfferId,
      });

      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.winnerDraw.update({
          where: { id: reservedDrawId! },
          data: { distributed: true, ccAmount: rewardCc },
        }),
        this.prisma.questCompletion.upsert({
          where: { userId_questId: { userId, questId } },
          create: {
            userId,
            questId,
            rewardMicroCc,
          },
          update: { rewardMicroCc },
        }),
      ]);
    } catch (err) {
      this.logger.warn(`FCFS claim on-chain failed: ${String(err)}`);
      await this.prisma.winnerDraw
        .deleteMany({
          where: { id: reservedDrawId, questId, userId, distributed: false },
        })
        .catch(() => {});
      throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
    }

    await this.releaseStaleFcfsReservations(questId);
    const slotsUsedAfter = await this.countFcfsSlotsTaken(questId);
    const rewardStatus = await this.getQuestRewardStatus(userId, questId);
    return {
      ok: true,
      message: `${rewardCc} CC sent to your wallet (${feeCc} CC claim fee paid).`,
      rewardCc,
      feeCc,
      remainingSlots: this.fcfsSlotsRemaining(maxWinners, slotsUsedAfter),
      rewardStatus,
    };
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
    if (period === 'all') {
      const users = await this.prisma.user.findMany({
        where: { earnPoints: { gt: 0 } },
        select: {
          id: true,
          username: true,
          displayName: true,
          cantonPartyId: true,
          earnPoints: true,
          avatarPath: true,
          twitterAvatarUrl: true,
        },
        orderBy: { earnPoints: 'desc' },
      });
      const total = users.length;
      const skip = (page - 1) * pageSize;
      const pageUsers = users.slice(skip, skip + pageSize);
      const rows: LeaderboardRow[] = pageUsers.map((u, i) => ({
        rank: skip + i + 1,
        userId: u.id,
        username: u.username ?? 'unknown',
        displayName: u.displayName ?? u.username ?? 'Unknown',
        cantonPartyId: u.cantonPartyId,
        points: u.earnPoints,
        avatarUrl: resolvePublicAvatarUrl(this.avatars, u),
      }));
      return { rows, total, page, pageSize };
    }

    const now = new Date();
    let since: Date | undefined;
    if (period === 'weekly') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'monthly') {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Period boards: activity in range (tasks + campaign completion bonuses)
    const subs = await this.prisma.questSubmission.findMany({
      where: {
        status: 'VERIFIED',
        ...(since ? { verifiedAt: { gte: since } } : {}),
      },
      include: {
        task: { select: { points: true } },
        user: {
          select: { id: true, username: true, displayName: true, cantonPartyId: true },
        },
      },
    });

    // Aggregate points per user
    const pointsMap = new Map<
      string,
      {
        userId: string;
        username: string | null;
        displayName: string | null;
        cantonPartyId: string | null;
        points: number;
      }
    >();
    for (const s of subs) {
      const existing = pointsMap.get(s.userId);
      if (existing) {
        existing.points += s.task.points;
        if (!existing.cantonPartyId && s.user.cantonPartyId) {
          existing.cantonPartyId = s.user.cantonPartyId;
        }
      } else {
        pointsMap.set(s.userId, {
          userId: s.user.id,
          username: s.user.username,
          displayName: s.user.displayName,
          cantonPartyId: s.user.cantonPartyId,
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

    const userIds = pageRows.map((u) => u.userId);
    const profileRows = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        avatarPath: true,
        cantonPartyId: true,
        twitterAvatarUrl: true,
      },
    });
    const profileByUser = new Map(profileRows.map((r) => [r.id, r]));

    const rows: LeaderboardRow[] = pageRows.map((u, i) => {
      const profile = profileByUser.get(u.userId);
      return {
        rank: skip + i + 1,
        userId: u.userId,
        username: u.username ?? 'unknown',
        displayName: u.displayName ?? u.username ?? 'Unknown',
        cantonPartyId: profile?.cantonPartyId ?? u.cantonPartyId ?? null,
        points: u.points,
        avatarUrl: profile
          ? resolvePublicAvatarUrl(this.avatars, profile)
          : null,
      };
    });

    return { rows, total, page, pageSize };
  }

  /* ─── User dashboard stats ─── */

  async getUserDashboardStats(userId: string): Promise<UserDashboardStats> {
    const totalPoints = await this.users.reconcileEarnPoints(userId);

    const [completions, txCount] = await Promise.all([
      this.prisma.questCompletion.count({ where: { userId } }),
      this.prisma.ccTransaction.count({ where: { userId } }),
    ]);

    const weeklyBoard = await this.getLeaderboard('weekly', 1, 10_000);
    const idx = weeklyBoard.rows.findIndex((r) => r.userId === userId);
    const weeklyRank = idx >= 0 ? idx + 1 : weeklyBoard.total + 1;

    return {
      totalPoints,
      questsCompleted: completions,
      txCount,
      weeklyRank,
    };
  }

  /* ─── Recent activity feed ─── */

  async getRecentActivity(
    userId: string,
    page = 1,
    pageSize = 5,
  ): Promise<{
    items: ActivityItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const fetchCap = 100;
    const [submissions, txs, completions] = await Promise.all([
      this.prisma.questSubmission.findMany({
        where: { userId, status: 'VERIFIED' },
        orderBy: { verifiedAt: 'desc' },
        take: fetchCap,
        include: { task: { select: { title: true, points: true } }, quest: { select: { title: true } } },
      }),
      this.prisma.ccTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: fetchCap,
      }),
      this.prisma.questCompletion.findMany({
        where: { userId },
        orderBy: { completedAt: 'desc' },
        take: fetchCap,
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
      if (tx.type === 'QUEST_REWARD') continue;
      const ccAmt = Math.abs(Number(tx.amountMicroCc)) / 1_000_000;
      const sign = tx.type === 'TRANSFER_OUT' ? '−' : '+';
      items.push({
        type: 'cc_transfer',
        title: tx.type === 'TRANSFER_OUT' ? 'CC sent' : 'CC received',
        detail: `${sign}${ccAmt.toFixed(2)} CC${tx.description ? ' · ' + tx.description : ''}`,
        time: tx.createdAt.toISOString(),
      });
    }

    const sorted = items.sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    );
    const total = sorted.length;
    const skip = (page - 1) * pageSize;
    return {
      items: sorted.slice(skip, skip + pageSize),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /* ─── Helpers ─── */

  private normalizeTaskType(type: string): string {
    if (type === 'telegram_join') return 'telegram_channel';
    return type;
  }

  private canAutoVerify(
    type: string,
    correctAnswer: string | null,
    proof?: string,
  ): boolean {
    const t = this.normalizeTaskType(type);
    switch (t) {
      case 'visit_website':
        return true;
      case 'quiz_yes_no':
        if (!correctAnswer || !proof) return false;
        return proof.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
      case 'quiz_choice':
        if (!correctAnswer || !proof) return false;
        return proof.trim().toUpperCase() === correctAnswer.trim().toUpperCase();
      case 'daily_check_in':
        return true;
      case 'submit_party_id':
      case 'submit_canton_address':
        return !!(proof && proof.includes('::'));
      case 'submit_email':
        return !!(proof && proof.includes('@'));
      case 'twitter_follow':
      case 'twitter_retweet':
        return false;
      case 'telegram_channel':
      case 'telegram_group':
      case 'discord_join':
        return true;
      default:
        return true;
    }
  }

  private async verifyTwitterTaskForUser(
    userId: string,
    taskType: string,
    taskTarget: string | null,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twitterUsername: true },
    });
    if (!user?.twitterUsername?.trim()) {
      throw new BadRequestException(
        'Connect your X (Twitter) account in Settings before completing this task.',
      );
    }
    if (!this.twitterApi.isConfigured()) {
      throw new BadRequestException(
        'Twitter verification is not configured on this server.',
      );
    }

    const handle = user.twitterUsername.trim();
    if (taskType === 'twitter_follow') {
      await this.twitterApi.verifyFollowTask(handle, taskTarget);
      return;
    }
    if (taskType === 'twitter_retweet') {
      await this.twitterApi.verifyRetweetTask(handle, taskTarget);
      return;
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
