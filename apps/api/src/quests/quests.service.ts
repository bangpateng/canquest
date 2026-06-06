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
  computePoolTotalCc,
  formatFcfsClaimFeeHint,
  formatFcfsSlotsRemainingLabel,
  requiresPaidInviteClaim,
  resolveClaimFeeCc,
  type QuestCampaignSummary,
} from './quest-reward-config';
import {
  QuestLedgerService,
  type QuestLedgerSubmitResult,
} from '../canton/quest-ledger.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { ProfileAvatarService } from '../users/profile-avatar.service';
import { resolvePublicAvatarUrl } from '../users/user-avatar-url';
import { PointsService } from '../users/points.service';
import { UsersService } from '../users/users.service';
import { hydrateTwitterAvatarUrls } from '../twitter/hydrate-twitter-avatars';
import { TwitterApiService } from '../twitter/twitter-api.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { withQuestMediaUrls } from '../storage/quest-media.util';
import { parseQuestSocialLinks } from './quest-social-links.util';

export interface LeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  twitterUsername: string | null;
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
  /** In-process guard (single API instance); DB lock is authoritative. */
  private readonly fcfsClaimInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly questLedger: QuestLedgerService,
    private readonly avatars: ProfileAvatarService,
    private readonly users: UsersService,
    private readonly points: PointsService,
    private readonly twitterApi: TwitterApiService,
    private readonly splice: SpliceValidatorService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly config: ConfigService,
    private readonly storage: R2StorageService,
  ) {}

  /** Map internal fee/ledger errors to a message the user can act on. */
  private fcfsClaimErrorMessage(detail: string): string {
    const d = detail.toLowerCase();
    if (
      d.includes('fee') ||
      d.includes('treasury') ||
      d.includes('validator') ||
      d.includes('mismatch') ||
      d.includes('offer') ||
      d.includes('balance did not increase') ||
      d.includes('in progress') ||
      d.includes('reward pool too low')
    ) {
      return `Claim fee failed: ${detail}`;
    }
    return FCFS_CLAIM_FAIL_MSG;
  }

  /**
   * CC FCFS (admin type "4 · Token CC"): user pays claim fee, then receives reward.
   * Earn campaigns with CC_ONLY always use claim-fcfs — never auto-send on Submit quest.
   */
  requiresFcfsCcClaim(quest: {
    rewardType: RewardType | string;
    maxWinners: number | null;
    questKind?: QuestKind | string;
  }): boolean {
    if (normalizeRewardType(quest.rewardType as RewardType) !== RewardType.CC_ONLY) {
      return false;
    }
    if (quest.questKind === QuestKind.CAMPAIGN || quest.questKind === 'CAMPAIGN') {
      return true;
    }
    return (quest.maxWinners ?? 0) > 0;
  }

  /** CC raffle (admin type "5 · Token CC manual"): admin draw after event; winners claim CC. */
  requiresDrawCcClaim(quest: { rewardType: RewardType | string }): boolean {
    return normalizeRewardType(quest.rewardType as RewardType) === RewardType.CC_MANUAL;
  }

  /** CC + Code combined raffle: admin draw after event; winners claim both CC and invite code. */
  requiresCcAndCodeRaffleClaim(quest: { rewardType: RewardType | string }): boolean {
    return normalizeRewardType(quest.rewardType as RewardType) === RewardType.CC_AND_CODE_RAFFLE;
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
        slotsTaken: null as number | null,
        slotsFull: false,
        fcfsClaimFeeCc: 0,
        requiresFcfsClaim: false,
        requiresDrawCcClaim: false,
        requiresPaidInviteClaim: false,
        codesRemaining: null as number | null,
      };
    }
    const maxWinners = quest.maxWinners;
    let remainingSlots: number | null = null;
    let slotsTaken: number | null = null;
    let slotsFull = false;
    if (maxWinners != null && maxWinners > 0) {
      await this.releaseStaleFcfsReservations(questId);
      const used = await this.countFcfsSlotsTaken(questId);
      remainingSlots = this.fcfsSlotsRemaining(maxWinners, used);
      slotsTaken = used;
      slotsFull = remainingSlots <= 0;
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
      slotsTaken,
      slotsFull,
      fcfsClaimFeeCc: resolveClaimFeeCc(quest) ?? 0,
      requiresFcfsClaim: this.requiresFcfsCcClaim(quest),
      requiresDrawCcClaim: this.requiresDrawCcClaim(quest),
      requiresPaidInviteClaim: requiresPaidInviteClaim(quest),
      codesRemaining: await this.countAvailableInviteCodes(questId),
    };
  }

  private async countAvailableInviteCodes(questId: string): Promise<number> {
    return this.prisma.inviteCodePool.count({
      where: { questId, userId: null },
    });
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

  private fcfsClaimLockKey(questId: string, userId: string): string {
    return `${questId}:${userId}`;
  }

  /** DB + memory lock so one user cannot run two on-chain FCFS claims at once. */
  private async acquireFcfsOnChainLock(params: {
    drawId: string;
    questId: string;
    userId: string;
  }): Promise<boolean> {
    const memKey = this.fcfsClaimLockKey(params.questId, params.userId);
    if (this.fcfsClaimInFlight.has(memKey)) {
      return false;
    }

    const staleCutoff = new Date(Date.now() - 120_000);
    const updated = await this.prisma.winnerDraw.updateMany({
      where: {
        id: params.drawId,
        questId: params.questId,
        userId: params.userId,
        distributed: false,
        OR: [{ fcfsClaimLockedAt: null }, { fcfsClaimLockedAt: { lt: staleCutoff } }],
      },
      data: { fcfsClaimLockedAt: new Date() },
    });
    if (updated.count !== 1) {
      return false;
    }
    this.fcfsClaimInFlight.add(memKey);
    return true;
  }

  private releaseFcfsOnChainLock(questId: string, userId: string, drawId: string): void {
    this.fcfsClaimInFlight.delete(this.fcfsClaimLockKey(questId, userId));
    void this.prisma.winnerDraw
      .updateMany({
        where: { id: drawId, distributed: false },
        data: { fcfsClaimLockedAt: null },
      })
      .catch(() => {});
  }

  /** Ensure validator wallet can cover the FCFS reward before sending. */
  private async assertValidatorRewardPool(rewardCc: number): Promise<void> {
    const treasuryAcceptUsername =
      this.config.get<string>('CANTON_FEE_ACCEPT_USERNAME')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER')?.trim() ||
      'administrator';
    const balance = await this.splice.getUserBalance(treasuryAcceptUsername);
    if (balance !== null && balance < rewardCc) {
      throw new Error(
        `Validator reward pool too low (${balance.toFixed(2)} CC available, need ${rewardCc} CC)`,
      );
    }
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
    const mapped = quests.map((q) =>
      withQuestMediaUrls(
        {
          ...q,
          tags: this.parseTags(q.tags),
          socialLinks: parseQuestSocialLinks(q.socialLinks),
          rewardType: normalizeRewardType(q.rewardType as RewardType),
          status: resolveQuestDisplayStatus(q),
        },
        this.storage,
      ),
    );
    const withSummary = await this.attachCampaignSummaries(mapped);
    const withStatus = withSummary.map((q) => this.applyCampaignListStatus(q));
    return status
      ? withStatus.filter((q) => q.status === status)
      : withStatus;
  }

  /** FCFS campaigns with no slots left surface as ENDED (Earn tabs + detail header). */
  private applyCampaignListStatus<
    T extends {
      status: QuestStatus;
      rewardType?: RewardType | string;
      campaignSummary?: QuestCampaignSummary;
    },
  >(q: T): T {
    const rt = q.rewardType ? normalizeRewardType(q.rewardType as RewardType) : null;
    const isCodeFcfs = rt === RewardType.INVITE_CODE_FCFS;
    const codeSlotsFull =
      isCodeFcfs &&
      q.status === QuestStatus.ACTIVE &&
      (q.campaignSummary?.slotsFull ||
        (q.campaignSummary?.codesRemaining != null && q.campaignSummary.codesRemaining <= 0));
    if (
      q.campaignSummary?.requiresFcfsClaim &&
      q.campaignSummary.slotsFull &&
      q.status === QuestStatus.ACTIVE
    ) {
      return { ...q, status: QuestStatus.ENDED };
    }
    if (codeSlotsFull) {
      return { ...q, status: QuestStatus.ENDED };
    }
    return q;
  }

  /** Live FCFS slots + pool totals for Earn campaign cards (batched). */
  private async attachCampaignSummaries<
    T extends {
      id: string;
      rewardType: RewardType | string;
      rewardCc: number;
      maxWinners: number | null;
      claimFeeCc?: number | null;
      questKind?: QuestKind | string;
    },
  >(quests: T[]): Promise<(T & { campaignSummary: QuestCampaignSummary })[]> {
    if (quests.length === 0) return [];

    const slotQuestIds = quests
      .filter((q) => (q.maxWinners ?? 0) > 0)
      .map((q) => q.id);

    const takenByQuest: Record<string, number> = {};
    if (slotQuestIds.length > 0) {
      await this.releaseStaleFcfsReservationsBatch(slotQuestIds);
      const grouped = await this.prisma.winnerDraw.groupBy({
        by: ['questId'],
        where: { questId: { in: slotQuestIds } },
        _count: { _all: true },
      });
      for (const row of grouped) {
        takenByQuest[row.questId] = row._count._all;
      }
    }

    const inviteFcfsIds = quests
      .filter(
        (q) =>
          normalizeRewardType(q.rewardType as RewardType) ===
          RewardType.INVITE_CODE_FCFS,
      )
      .map((q) => q.id);
    const codesByQuest: Record<string, number> = {};
    if (inviteFcfsIds.length > 0) {
      const codeCounts = await this.prisma.inviteCodePool.groupBy({
        by: ['questId'],
        where: { questId: { in: inviteFcfsIds }, userId: null },
        _count: { _all: true },
      });
      for (const row of codeCounts) {
        codesByQuest[row.questId] = row._count._all;
      }
    }

    return quests.map((q) => {
      const maxWinners = q.maxWinners;
      const taken = takenByQuest[q.id] ?? 0;
      const remainingSlots =
        maxWinners != null && maxWinners > 0
          ? this.fcfsSlotsRemaining(maxWinners, taken)
          : null;
      const slotsTaken =
        maxWinners != null && maxWinners > 0 ? taken : null;
      const slotsFull =
        remainingSlots != null && maxWinners != null && maxWinners > 0
          ? remainingSlots <= 0
          : false;
      const requiresFcfsClaim = this.requiresFcfsCcClaim(q);
      const summary: QuestCampaignSummary = {
        requiresFcfsClaim,
        requiresDrawCcClaim: this.requiresDrawCcClaim(q),
        requiresPaidInviteClaim: requiresPaidInviteClaim(q),
        maxWinners,
        remainingSlots,
        slotsTaken,
        slotsFull,
        fcfsClaimFeeCc: resolveClaimFeeCc(q) ?? 0,
        poolTotalCc: computePoolTotalCc(q.rewardCc, maxWinners),
        codesRemaining:
          normalizeRewardType(q.rewardType as RewardType) ===
          RewardType.INVITE_CODE_FCFS
            ? (codesByQuest[q.id] ?? 0)
            : null,
      };
      return { ...q, campaignSummary: summary };
    });
  }

  private async releaseStaleFcfsReservationsBatch(
    questIds: string[],
    tx: PrismaTx | PrismaService = this.prisma,
  ): Promise<void> {
    if (questIds.length === 0) return;
    const cutoff = new Date(Date.now() - this.fcfsReservationTtlMs());
    const result = await tx.winnerDraw.deleteMany({
      where: {
        questId: { in: questIds },
        distributed: false,
        drawnAt: { lt: cutoff },
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `FCFS: cleared ${result.count} stale reservation(s) across ${questIds.length} quest(s)`,
      );
    }
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
      socialLinks: parseQuestSocialLinks(q.socialLinks),
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

  async getQuestKind(questId: string): Promise<QuestKind | null> {
    const q = await this.prisma.quest.findUnique({
      where: { id: questId },
      select: { questKind: true },
    });
    return q?.questKind ?? null;
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
    const mapped = withQuestMediaUrls(
      {
        ...q,
        tags: this.parseTags(q.tags),
        socialLinks: parseQuestSocialLinks(q.socialLinks),
        rewardType: normalizeRewardType(q.rewardType as RewardType),
        status: resolveQuestDisplayStatus(q),
      },
      this.storage,
    );
    if (mapped.questKind !== QuestKind.CAMPAIGN) return mapped;
    const [withSummary] = await this.attachCampaignSummaries([mapped]);
    return this.applyCampaignListStatus(withSummary);
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
      completionContractId: null,
      rewardContractId: completion.ledgerRewardId,
      taskSubmissionIds,
      errors: [],
    };
  }

  private emptyLedgerResult(errors: string[] = []): QuestLedgerSubmitResult {
    return {
      ledgerEnabled: false,
      participationContractId: null,
      completionContractId: null,
      rewardContractId: null,
      taskSubmissionIds: [],
      errors,
    };
  }

  private damlQuestKind(kind: QuestKind): 'EARN_HUB' | 'CAMPAIGN' {
    return kind === QuestKind.EARN_HUB ? 'EARN_HUB' : 'CAMPAIGN';
  }

  /** FCFS/invite claims skip submitQuest — record DAML completion + mark reward after CIP-56 payout. */
  private async syncCampaignLedgerAfterPayout(params: {
    userId: string;
    questId: string;
    userPartyId: string;
    rewardCc: number;
    payoutTxId: string;
  }): Promise<void> {
    if (!this.questLedger.isConfigured()) return;

    const quest = await this.prisma.quest.findUnique({
      where: { id: params.questId },
      include: { tasks: true },
    });
    if (!quest) return;

    const submissions = await this.prisma.questSubmission.findMany({
      where: {
        userId: params.userId,
        questId: params.questId,
        status: SubmissionStatus.VERIFIED,
      },
    });

    const ledgerResult = await this.questLedger.recordQuestCompletion({
      questId: params.questId,
      questKind: this.damlQuestKind(quest.questKind),
      questTitle: quest.title,
      rewardCc: params.rewardCc,
      userPartyId: params.userPartyId,
      taskIds: quest.tasks.map((t) => t.id),
      proofs: submissions.map((s) => {
        const t = quest.tasks.find((qt) => qt.id === s.taskId);
        return {
          taskId: s.taskId,
          taskType: t ? this.normalizeTaskType(t.type) : 'unknown',
          proof: s.proof,
        };
      }),
    });

    if (ledgerResult.errors.length > 0) {
      this.logger.warn(
        `Campaign ledger sync: quest=${params.questId} ${ledgerResult.errors.join(' | ')}`,
      );
    }

    await this.prisma.questCompletion.updateMany({
      where: { userId: params.userId, questId: params.questId },
      data: {
        ledgerParticipationId: ledgerResult.participationContractId,
        ledgerRewardId: ledgerResult.rewardContractId,
        ledgerTaskSubmissionIds: ledgerResult.taskSubmissionIds,
      },
    });

    if (ledgerResult.rewardContractId) {
      const marked = await this.questLedger.markRewardClaimed({
        rewardContractId: ledgerResult.rewardContractId,
        payoutTxId: params.payoutTxId,
      });
      if (!marked.ok) {
        this.logger.warn(`QuestReward mark claimed: ${marked.errors.join(' | ')}`);
      }
    }
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
    completionContractId: string | null;
    rewardContractId: string | null;
    taskSubmissionCount: number;
    cip56Queued: boolean;
    errors: string[];
  } | null {
    if (!ledger) return null;
    return {
      enabled: ledger.ledgerEnabled,
      participationContractId: ledger.participationContractId,
      completionContractId: ledger.completionContractId,
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
      select: {
        questKind: true,
        rewardType: true,
        maxWinners: true,
        endsAt: true,
        deadline: true,
      },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    if (
      quest.questKind === QuestKind.CAMPAIGN &&
      this.isCampaignEnded(quest)
    ) {
      throw new BadRequestException('This campaign has ended. Submissions are closed.');
    }

    if (
      quest.questKind === QuestKind.CAMPAIGN &&
      this.requiresFcfsCcClaim(quest) &&
      (quest.maxWinners ?? 0) > 0
    ) {
      await this.releaseStaleFcfsReservations(questId);
      const used = await this.countFcfsSlotsTaken(questId);
      const remaining = this.fcfsSlotsRemaining(quest.maxWinners!, used);
      if (remaining <= 0) {
        const priorSubs = await this.prisma.questSubmission.count({
          where: { userId, questId },
        });
        if (priorSubs === 0) {
          throw new BadRequestException(
            'All reward slots are taken. New participants cannot join this campaign.',
          );
        }
      }
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
          // canquest-v4: daily check-in dicatat on-chain via DailyCheckIn template
          if (userPartyId && this.questLedger.isClaimSessionConfigured()) {
            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            void this.questLedger
              .recordDailyCheckIn({
                userPartyId,
                username: (await this.users.findById(userId))?.username ?? userPartyId.split('::')[0],
                userId,
                checkInDate: today,
                pointsAwarded: task.points,
                streakCount: 1,
              })
              .catch((err) =>
                this.logger.warn(`Daily check-in ledger: ${String(err)}`),
              );
          }
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

    if (
      autoVerify &&
      userPartyId &&
      this.questLedger.isConfigured()
    ) {
      const taskLedger = await this.questLedger.recordTaskSubmission({
        questId,
        questKind: this.damlQuestKind(quest.questKind),
        taskId,
        taskType,
        proof: proof ?? null,
        userPartyId,
      });
      if (taskLedger.errors.length > 0) {
        this.logger.warn(
          `Task ledger: quest=${questId} task=${taskId} ${taskLedger.errors.join(' | ')}`,
        );
      } else if (taskLedger.taskSubmissionContractId) {
        this.logger.log(
          `Task ledger OK: quest=${questId} task=${taskId} submission=${taskLedger.taskSubmissionContractId.slice(0, 24)}…`,
        );
      }
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
        ledger: this.emptyLedgerResult(['Tasks incomplete']),
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
        ledger: this.emptyLedgerResult(),
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
        ledger: this.emptyLedgerResult(),
      };
    }
    if (quest.endsAt && quest.endsAt < now) {
      return {
        ok: false,
        message: 'Quest has ended',
        rewardCc: 0,
        inviteCode: null,
        rewardStatus: await this.getQuestRewardStatus(userId, questId),
        ledger: this.emptyLedgerResult(),
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

    if (needsInvite && quest.maxWinners && !requiresPaidInviteClaim(quest)) {
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

    let ledgerResult: QuestLedgerSubmitResult = this.emptyLedgerResult();

    if (userPartyId && this.questLedger.isConfigured()) {
      ledgerResult = await this.questLedger.recordQuestCompletion({
        questId,
        questKind: this.damlQuestKind(quest.questKind),
        questTitle: quest.title,
        rewardCc,
        userPartyId,
        taskIds: quest.tasks.map((t) => t.id),
        proofs: submissions.map((s) => {
          const t = quest.tasks.find((qt) => qt.id === s.taskId);
          return {
            taskId: s.taskId,
            taskType: t ? this.normalizeTaskType(t.type) : 'unknown',
            proof: s.proof,
          };
        }),
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
      if (draw) {
        const custom = quest.winnerMessage?.trim();
        return {
          state: 'winner' as const,
          inviteCode: null,
          message: custom || 'Kamu pemenang! Cek email kamu untuk langkah selanjutnya.',
        };
      }
      const drawsHeld = await this.prisma.winnerDraw.count({ where: { questId } });
      if (drawsHeld > 0) {
        return {
          state: 'not_winner' as const,
          inviteCode: null,
          message: 'You Not Lucky',
        };
      }
      if (this.isCampaignEnded(quest)) {
        return {
          state: 'pending_draw' as const,
          inviteCode: null,
          message: 'Event selesai. Pemenang akan diumumkan setelah admin draw.',
        };
      }
      return {
        state: 'waitlist' as const,
        inviteCode: null,
        message:
          'Pemenang akan diumumkan setelah event berakhir.',
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
      if (requiresPaidInviteClaim(quest) && completion) {
        const codesLeft = await this.countAvailableInviteCodes(questId);
        const maxW = quest.maxWinners ?? 0;
        const claimed = await this.prisma.winnerDraw.count({
          where: { questId, inviteCode: { not: null } },
        });
        const remaining =
          maxW > 0 ? this.fcfsSlotsRemaining(maxW, claimed) : codesLeft;
        if (remaining <= 0 || codesLeft <= 0) {
          return {
            state: 'fcfs_missed' as const,
            inviteCode: null,
            message: 'Full claimed — all codes have been taken.',
          };
        }
        const fee = resolveClaimFeeCc(quest) ?? 2;
        return {
          state: 'fcfs_claimable' as const,
          inviteCode: null,
          message: `${remaining} code(s) left — pay ${fee} CC claim fee to reveal your voucher.`,
        };
      }
      return {
        state: 'fcfs_missed' as const,
        inviteCode: null,
        message: 'Full claimed — all codes have been taken.',
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
      if (draw && requiresPaidInviteClaim(quest)) {
        const codesLeft = await this.countAvailableInviteCodes(questId);
        if (codesLeft <= 0) {
          return {
            state: 'fcfs_missed' as const,
            inviteCode: null,
            message: 'No invite codes left in the pool. Contact support.',
          };
        }
        const fee = resolveClaimFeeCc(quest) ?? 2;
        return {
          state: 'fcfs_claimable' as const,
          inviteCode: null,
          message: `You won the raffle! Pay ${fee} CC claim fee to reveal your code.`,
        };
      }
      const drawsHeld = await this.prisma.winnerDraw.count({ where: { questId } });
      if (drawsHeld > 0) {
        return {
          state: 'not_winner' as const,
          inviteCode: null,
          message: 'You Not Lucky',
        };
      }
      return {
        state: 'pending_draw' as const,
        inviteCode: null,
        message:
          'Quest submitted. You will see your invite code here if you are selected in the admin draw.',
      };
    }

    if (rewardType === RewardType.CC_MANUAL) {
      if (draw?.distributed) {
        return {
          state: 'cc_reward' as const,
          inviteCode: null,
          message:
            quest.rewardCc > 0
              ? `${quest.rewardCc} CC sent to your wallet.`
              : 'CC reward claim completed.',
        };
      }
      if (draw) {
        const fee = resolveClaimFeeCc(quest) ?? 3;
        return {
          state: 'fcfs_claimable' as const,
          inviteCode: null,
          message: `You won ${quest.rewardCc} CC. Pay ${fee} CC claim fee to receive your reward.`,
        };
      }
      const drawsHeld = await this.prisma.winnerDraw.count({ where: { questId } });
      if (drawsHeld > 0) {
        return {
          state: 'not_winner' as const,
          inviteCode: null,
          message: 'You were not selected in the raffle draw.',
        };
      }
      if (this.isCampaignEnded(quest)) {
        return {
          state: 'pending_draw' as const,
          inviteCode: null,
          message: 'The event has ended. Winners will be announced after the admin draw.',
        };
      }
      return {
        state: 'waitlist' as const,
        inviteCode: null,
        message: 'Winners will be announced after the event ends.',
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
        const maxW = quest.maxWinners ?? 0;
        const slotsUsed = await this.countFcfsSlotsTaken(questId);
        const remaining = this.fcfsSlotsRemaining(maxW, slotsUsed);
        const fee = resolveClaimFeeCc(quest) ?? 3;
        return {
          state: 'cc_reward' as const,
          inviteCode: null,
          message:
            maxW > 0
              ? `${formatFcfsSlotsRemainingLabel(remaining, maxW)}\n${formatFcfsClaimFeeHint(fee, quest.rewardCc)}`
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
      const fee = resolveClaimFeeCc(quest) ?? 3;
      return {
        state: 'fcfs_claimable' as const,
        inviteCode: null,
        message: `${formatFcfsSlotsRemainingLabel(remaining, maxW)}\n${formatFcfsClaimFeeHint(fee, quest.rewardCc)}`,
      };
    }

    // ── CC + Code Combined Raffle ──────────────────────────────────────────
    if (rewardType === RewardType.CC_AND_CODE_RAFFLE) {
      if (draw?.distributed && draw.inviteCode) {
        const custom = quest.winnerMessage?.trim();
        return {
          state: 'cc_reward' as const,
          inviteCode: draw.inviteCode,
          message: custom || `Congratulations! You received ${quest.rewardCc} CC and code: ${draw.inviteCode}`,
        };
      }
      if (draw?.distributed && !draw.inviteCode) {
        return {
          state: 'cc_reward' as const,
          inviteCode: null,
          message: `${quest.rewardCc} CC sent to your wallet. Code will be assigned shortly.`,
        };
      }
      if (draw) {
        const fee = resolveClaimFeeCc(quest) ?? 5;
        const codesLeft = await this.countAvailableInviteCodes(questId);
        if (codesLeft <= 0) {
          return {
            state: 'fcfs_missed' as const,
            inviteCode: null,
            message: 'No codes left in the pool. Contact support.',
          };
        }
        const custom = quest.winnerMessage?.trim();
        return {
          state: 'fcfs_claimable' as const,
          inviteCode: null,
          message: custom || `You won! Pay ${fee} CC claim fee to receive ${quest.rewardCc} CC + your invite code.`,
        };
      }
      const drawsHeld = await this.prisma.winnerDraw.count({ where: { questId } });
      if (drawsHeld > 0) {
        return {
          state: 'not_winner' as const,
          inviteCode: null,
          message: 'You were not selected in the raffle draw.',
        };
      }
      if (this.isCampaignEnded(quest)) {
        return {
          state: 'pending_draw' as const,
          inviteCode: null,
          message: 'The event has ended. Winners will be announced after the admin draw.',
        };
      }
      return {
        state: 'waitlist' as const,
        inviteCode: null,
        message: 'Winners will be announced after the event ends.',
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

    const feeCc = resolveClaimFeeCc(quest) ?? 3;
    const rewardCc = quest.rewardCc;
    const maxWinners = quest.maxWinners ?? 0;

    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (!validatorPartyId) {
      throw new BadRequestException('Validator party is not configured on the server.');
    }

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
      const existingDraw = await this.prisma.winnerDraw.findUnique({
        where: { questId_userId: { questId, userId } },
      });
      // Recovery: reward was sent (old bug / admin distribute) but claim fee never recorded.
      if (
        existingDraw?.distributed &&
        !existingDraw.claimFeeLedgerTxId &&
        feeCc > 0 &&
        validatorPartyId
      ) {
        this.logger.warn(
          `FCFS fee recovery: user ${userId} quest ${questId} — reward sent without claimFeeLedgerTxId`,
        );
        try {
          const feeTxId = await this.collectClaimFee({
            userId,
            username,
            questTitle: quest.title,
            feeCc,
            feeLabel: 'FCFS claim fee (recovery)',
            validatorPartyId,
          });
          await this.prisma.winnerDraw.update({
            where: { id: existingDraw.id },
            data: { claimFeeLedgerTxId: feeTxId },
          });
          const rewardStatus = await this.getQuestRewardStatus(userId, questId);
          const taken = await this.countFcfsSlotsTaken(questId);
          return {
            ok: true,
            message: `Claim fee ${feeCc} CC sent to validator (${validatorPartyId.split('::')[0]}).`,
            rewardCc,
            feeCc,
            remainingSlots: this.fcfsSlotsRemaining(maxWinners, taken),
            rewardStatus,
          };
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new BadRequestException(this.fcfsClaimErrorMessage(detail));
        }
      }

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

    const reservedDraw = await this.prisma.winnerDraw.findUnique({
      where: { id: reservedDrawId },
    });
    const feeAlreadyPaid = Boolean(reservedDraw?.claimFeeLedgerTxId);

    if (!feeAlreadyPaid) {
      const balance = await this.splice.getUserBalance(username);
      if (balance !== null && balance < feeCc) {
        if (isNewReservation) {
          await this.prisma.winnerDraw.delete({ where: { id: reservedDrawId } }).catch(() => {});
        }
        throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
      }
    }

    const maxPayoutExposure = maxWinners * rewardCc;
    this.logger.log(
      `FCFS claim start quest=${questId} user=@${username} fee=${feeCc} reward=${rewardCc} validator=${validatorPartyId.split('::')[0]} (max pool exposure ~${maxPayoutExposure} CC for ${maxWinners} slots)`,
    );

    const onChainLocked = await this.acquireFcfsOnChainLock({
      drawId: reservedDrawId,
      questId,
      userId,
    });
    if (!onChainLocked) {
      if (isNewReservation) {
        await this.prisma.winnerDraw.delete({ where: { id: reservedDrawId } }).catch(() => {});
      }
      throw new BadRequestException(
        'Claim already in progress. Wait a moment before trying again.',
      );
    }

    try {
      const drawNow = await this.prisma.winnerDraw.findUnique({
        where: { id: reservedDrawId },
      });
      if (drawNow?.distributed) {
        throw new Error('FCFS reward already distributed for this user');
      }

      // Best-effort DAML audit: create ClaimSession (operator signs, user observes).
      let claimSessionId: string | null = null;
      if (this.questLedger.isClaimSessionConfigured()) {
        const cs = await this.questLedger.createClaimSession({
          questId,
          userPartyId: cantonPartyId,
          claimKind: 'fcfs_cc',
          feeCc,
          rewardCc,
        });
        claimSessionId = cs.sessionContractId;
        if (cs.errors.length > 0) {
          this.logger.warn(`ClaimSession create warnings: ${cs.errors.join(' | ')}`);
        }
      }

      // NEW: Create EarnClaimSession for earn-specific audit trail (Canton M3 pattern)
      let earnClaimSessionId: string | null = null;
      if (this.questLedger.isClaimSessionConfigured()) {
        const ecs = await this.questLedger.createEarnClaimSession({
          userPartyId: cantonPartyId,
          campaignId: questId,
          claimKind: 'CC_FCFS',
          feeCc,
          rewardCc,
        });
        earnClaimSessionId = ecs.contractId;
        if (ecs.error) {
          this.logger.warn(`EarnClaimSession create warning: ${ecs.error}`);
        }
      }

      // NEW: Create FcfsSlotReservation on ledger for slot tracking
      if (this.questLedger.isConfigured() && maxWinners > 0) {
        const slotIndex = await this.countFcfsSlotsTaken(questId) - 1; // Current slot index
        const expiresAt = new Date(Date.now() + this.fcfsReservationTtlMs()).toISOString();
        const slotRes = await this.questLedger.createFcfsSlotReservation({
          userPartyId: cantonPartyId,
          campaignId: questId,
          slotIndex,
          expiresAt,
        });
        if (slotRes.error) {
          this.logger.warn(`FcfsSlotReservation create warning: ${slotRes.error}`);
        }
      }

      // NEW: Create CcRewardEntitlement for CC reward tracking
      if (this.questLedger.isConfigured()) {
        const entitlementRes = await this.questLedger.createCcRewardEntitlement({
          userPartyId: cantonPartyId,
          campaignId: questId,
          rewardCc,
          feeCc,
          claimKind: 'CC_FCFS',
        });
        if (entitlementRes.error) {
          this.logger.warn(`CcRewardEntitlement create warning: ${entitlementRes.error}`);
        }
      }

      // Step 1: user pays claim fee → validator node party (CANTON_VALIDATOR_PARTY_ID).
      // If the fee was already paid (previous attempt), skip collecting again.
      const feeTxId =
        drawNow?.claimFeeLedgerTxId ??
        (await this.collectClaimFee({
          userId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'FCFS claim fee',
          validatorPartyId,
        }));

      // Persist fee TX early so retries don't double-charge and slot stays reserved.
      if (!drawNow?.claimFeeLedgerTxId) {
        await this.prisma.winnerDraw.updateMany({
          where: { id: reservedDrawId, questId, userId, distributed: false, claimFeeLedgerTxId: null },
          data: { claimFeeLedgerTxId: feeTxId },
        });
      }

      if (claimSessionId) {
        const marked = await this.questLedger.markClaimFeePaid({
          sessionContractId: claimSessionId,
          feeTxId,
        });
        if (!marked.ok) {
          this.logger.warn(`ClaimSession fee mark failed: ${marked.errors.join(' | ')}`);
        }
      }

      // NEW: Mark EarnClaimSession fee paid
      if (earnClaimSessionId) {
        const earnFeeMarked = await this.questLedger.markEarnClaimFeePaid({
          sessionContractId: earnClaimSessionId,
          feeTxId,
        });
        if (!earnFeeMarked.ok) {
          this.logger.warn(`EarnClaimSession fee mark failed: ${earnFeeMarked.errors.join(' | ')}`);
        }
      }

      // Step 2: validator wallet sends reward → same user party (only after fee is on validator).
      await this.assertValidatorRewardPool(rewardCc);
      this.logger.log(
        `Claim fee step 2: ${validatorPartyId.split('::')[0]} → ${cantonPartyId.split('::')[0]} (@${username}, ${rewardCc} CC)`,
      );
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

      if (claimSessionId) {
        const marked = await this.questLedger.markClaimRewardSent({
          sessionContractId: claimSessionId,
          rewardTxId: rewardOfferId,
        });
        if (!marked.ok) {
          this.logger.warn(`ClaimSession reward mark failed: ${marked.errors.join(' | ')}`);
        }
      }

      // NEW: Mark EarnClaimSession reward sent
      if (earnClaimSessionId) {
        const earnMarked = await this.questLedger.markEarnClaimRewardSent({
          sessionContractId: earnClaimSessionId,
          rewardTxId: rewardOfferId,
        });
        if (!earnMarked.ok) {
          this.logger.warn(`EarnClaimSession reward mark failed: ${earnMarked.errors.join(' | ')}`);
        }
      }

      await this.users.recordTransaction({
        userId,
        amountCc: rewardCc,
        type: 'QUEST_REWARD',
        description: `Received ${rewardCc} CC reward`,
        referenceId: questId,
        counterparty: validatorPartyId.split('::')[0],
        ledgerTxId: rewardOfferId,
      });

      if (username) {
        await this.inboundSync.alignBalanceFromChain(userId, username);
      }

      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.winnerDraw.update({
          where: { id: reservedDrawId! },
          data: {
            distributed: true,
            ccAmount: rewardCc,
            claimFeeLedgerTxId: feeTxId,
            ledgerTxId: rewardOfferId,
            ...(claimSessionId ? { claimSessionContractId: claimSessionId } : {}),
          },
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

      if (cantonPartyId) {
        void this.syncCampaignLedgerAfterPayout({
          userId,
          questId,
          userPartyId: cantonPartyId,
          rewardCc,
          payoutTxId: rewardOfferId,
        }).catch((err) =>
          this.logger.warn(`FCFS ledger sync failed: ${String(err)}`),
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`FCFS claim on-chain failed: ${detail}`);
      await this.prisma.winnerDraw
        .deleteMany({
          // Only release the slot when the claim fee was NOT collected.
          // If fee was paid, keep the reservation so the user can retry without losing the slot.
          where: {
            id: reservedDrawId,
            questId,
            userId,
            distributed: false,
            claimFeeLedgerTxId: null,
          },
        })
        .catch(() => {});
      throw new BadRequestException(this.fcfsClaimErrorMessage(detail));
    } finally {
      this.releaseFcfsOnChainLock(questId, userId, reservedDrawId);
    }

    await this.releaseStaleFcfsReservations(questId);
    const slotsUsedAfter = await this.countFcfsSlotsTaken(questId);
    const rewardStatus = await this.getQuestRewardStatus(userId, questId);
    const remainingAfter = this.fcfsSlotsRemaining(maxWinners, slotsUsedAfter);
    return {
      ok: true,
      message: `${formatFcfsSlotsRemainingLabel(remainingAfter, maxWinners)}\n${formatFcfsClaimFeeHint(feeCc, rewardCc)}`,
      rewardCc,
      feeCc,
      remainingSlots: remainingAfter,
      rewardStatus,
    };
  }

  /**
   * CC raffle claim — winner selected by admin draw pays claim fee, receives reward CC.
   */
  async claimDrawCcReward(params: {
    userId: string;
    username: string | null;
    cantonPartyId: string | null;
    questId: string;
  }): Promise<{
    ok: boolean;
    message: string;
    rewardCc: number;
    feeCc: number;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
  }> {
    const { userId, questId, username, cantonPartyId } = params;
    if (!username?.trim() || !cantonPartyId?.trim()) {
      throw new BadRequestException('Create your Canton wallet before claiming.');
    }

    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) throw new NotFoundException('Quest not found');
    if (!this.requiresDrawCcClaim(quest)) {
      throw new BadRequestException('This campaign does not use raffle CC claim.');
    }

    const completion = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (!completion) {
      throw new BadRequestException('Submit the quest before claiming your reward.');
    }

    const draw = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (!draw) {
      throw new BadRequestException('You were not selected in the raffle draw.');
    }
    if (draw.distributed) {
      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      return {
        ok: true,
        message: 'You already claimed this reward.',
        rewardCc: quest.rewardCc,
        feeCc: 0,
        rewardStatus,
      };
    }

    const feeCc = resolveClaimFeeCc(quest) ?? 3;
    const rewardCc = quest.rewardCc;
    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (!validatorPartyId) {
      throw new BadRequestException('Validator party is not configured on the server.');
    }

    const balance = await this.splice.getUserBalance(username);
    if (balance !== null && balance < feeCc) {
      throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
    }

    this.logger.log(
      `Draw CC claim start quest=${questId} user=@${username} fee=${feeCc} reward=${rewardCc}`,
    );

    try {
      let claimSessionId: string | null = null;
      if (this.questLedger.isClaimSessionConfigured()) {
        const cs = await this.questLedger.createClaimSession({
          questId,
          userPartyId: cantonPartyId,
          claimKind: 'fcfs_cc',
          feeCc,
          rewardCc,
        });
        claimSessionId = cs.sessionContractId;
        if (cs.errors.length > 0) {
          this.logger.warn(`ClaimSession create warnings: ${cs.errors.join(' | ')}`);
        }
      }

      // NEW: Create EarnClaimSession for CC Raffle audit trail (Canton M3 pattern)
      let earnClaimSessionId: string | null = null;
      if (this.questLedger.isClaimSessionConfigured()) {
        const ecs = await this.questLedger.createEarnClaimSession({
          userPartyId: cantonPartyId,
          campaignId: questId,
          claimKind: 'CC_RAFFLE',
          feeCc,
          rewardCc,
        });
        earnClaimSessionId = ecs.contractId;
        if (ecs.error) {
          this.logger.warn(`EarnClaimSession (CC_RAFFLE) create warning: ${ecs.error}`);
        }
      }

      // NEW: Create RaffleWinner on ledger for winner tracking
      if (this.questLedger.isConfigured()) {
        const winnerRes = await this.questLedger.createRaffleWinner({
          userPartyId: cantonPartyId,
          campaignId: questId,
          rewardCc,
        });
        if (winnerRes.error) {
          this.logger.warn(`RaffleWinner create warning: ${winnerRes.error}`);
        }
      }

      // NEW: Create CcRewardEntitlement for CC raffle reward tracking
      if (this.questLedger.isConfigured()) {
        const entitlementRes = await this.questLedger.createCcRewardEntitlement({
          userPartyId: cantonPartyId,
          campaignId: questId,
          rewardCc,
          feeCc,
          claimKind: 'CC_RAFFLE',
        });
        if (entitlementRes.error) {
          this.logger.warn(`CcRewardEntitlement (CC_RAFFLE) create warning: ${entitlementRes.error}`);
        }
      }

      const feeTxId = await this.collectClaimFee({
        userId,
        username,
        questTitle: quest.title,
        feeCc,
        feeLabel: 'Raffle claim fee',
        validatorPartyId,
      });

      if (claimSessionId) {
        const marked = await this.questLedger.markClaimFeePaid({
          sessionContractId: claimSessionId,
          feeTxId,
        });
        if (!marked.ok) {
          this.logger.warn(`ClaimSession fee mark failed: ${marked.errors.join(' | ')}`);
        }
      }

      // NEW: Mark EarnClaimSession fee paid for CC Raffle
      if (earnClaimSessionId) {
        const earnFeeMarked = await this.questLedger.markEarnClaimFeePaid({
          sessionContractId: earnClaimSessionId,
          feeTxId,
        });
        if (!earnFeeMarked.ok) {
          this.logger.warn(`EarnClaimSession (CC_RAFFLE) fee mark failed: ${earnFeeMarked.errors.join(' | ')}`);
        }
      }

      await this.assertValidatorRewardPool(rewardCc);
      const rewardOfferId = await this.splice.createTransferOffer(
        cantonPartyId,
        rewardCc,
        `Raffle reward — ${quest.title}`,
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

      if (claimSessionId) {
        const marked = await this.questLedger.markClaimRewardSent({
          sessionContractId: claimSessionId,
          rewardTxId: rewardOfferId,
        });
        if (!marked.ok) {
          this.logger.warn(`ClaimSession reward mark failed: ${marked.errors.join(' | ')}`);
        }
      }

      // NEW: Mark EarnClaimSession reward sent for CC Raffle
      if (earnClaimSessionId) {
        const earnRewardMarked = await this.questLedger.markEarnClaimRewardSent({
          sessionContractId: earnClaimSessionId,
          rewardTxId: rewardOfferId,
        });
        if (!earnRewardMarked.ok) {
          this.logger.warn(`EarnClaimSession (CC_RAFFLE) reward mark failed: ${earnRewardMarked.errors.join(' | ')}`);
        }
      }

      await this.users.recordTransaction({
        userId,
        amountCc: rewardCc,
        type: 'QUEST_REWARD',
        description: `Received ${rewardCc} CC raffle reward`,
        referenceId: questId,
        counterparty: validatorPartyId.split('::')[0],
        ledgerTxId: rewardOfferId,
      });

      if (username) {
        await this.inboundSync.alignBalanceFromChain(userId, username);
      }

      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.winnerDraw.update({
          where: { id: draw.id },
          data: {
            distributed: true,
            ccAmount: rewardCc,
            claimFeeLedgerTxId: feeTxId,
            ledgerTxId: rewardOfferId,
            distributedAt: new Date(),
            ...(claimSessionId ? { claimSessionContractId: claimSessionId } : {}),
          },
        }),
        this.prisma.questCompletion.upsert({
          where: { userId_questId: { userId, questId } },
          create: {
            userId,
            questId,
            rewardMicroCc,
            completedAt: completion.completedAt,
          },
          update: { rewardMicroCc },
        }),
      ]);

      if (cantonPartyId) {
        void this.syncCampaignLedgerAfterPayout({
          userId,
          questId,
          userPartyId: cantonPartyId,
          rewardCc,
          payoutTxId: rewardOfferId,
        }).catch((err) =>
          this.logger.warn(`Draw CC ledger sync failed: ${String(err)}`),
        );
      }

      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      return {
        ok: true,
        message: `${rewardCc} CC sent to your wallet.`,
        rewardCc,
        feeCc,
        rewardStatus,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(this.fcfsClaimErrorMessage(detail));
    }
  }

  /**
   * Paid claim for invite / waitlist codes (FCFS or post-raffle).
   * User pays claim fee on-chain, then receives one code from the pool.
   */
  async claimInviteReward(params: {
    userId: string;
    username: string | null;
    cantonPartyId: string | null;
    questId: string;
  }): Promise<{
    ok: boolean;
    message: string;
    inviteCode: string | null;
    feeCc: number;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
  }> {
    const { userId, questId, username, cantonPartyId } = params;
    if (!username?.trim() || !cantonPartyId?.trim()) {
      throw new BadRequestException('Create your Canton wallet before claiming.');
    }

    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) throw new NotFoundException('Quest not found');

    const rewardType = normalizeRewardType(quest.rewardType as RewardType);
    const paidInvite =
      requiresPaidInviteClaim(quest) &&
      (rewardType === RewardType.INVITE_CODE_FCFS ||
        rewardType === RewardType.INVITE_CODE_RANDOM ||
        rewardType === RewardType.INVITE_CODE);
    if (!paidInvite) {
      throw new BadRequestException('This campaign does not use paid code claim.');
    }

    const completion = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (!completion) {
      throw new BadRequestException('Submit the quest before claiming your code.');
    }

    const allDone = await this.areAllTasksVerified(userId, questId);
    if (!allDone) {
      throw new BadRequestException('Complete all missions before claiming.');
    }

    const existingDraw = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (existingDraw?.inviteCode) {
      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      return {
        ok: true,
        message: 'Code already claimed.',
        inviteCode: existingDraw.inviteCode,
        feeCc: 0,
        rewardStatus,
      };
    }

    if (
      rewardType === RewardType.INVITE_CODE_RANDOM ||
      rewardType === RewardType.INVITE_CODE
    ) {
      if (!existingDraw) {
        throw new BadRequestException('You were not selected in the raffle draw.');
      }
      if (this.isCampaignEnded(quest) === false) {
        const drawsHeld = await this.prisma.winnerDraw.count({ where: { questId } });
        if (drawsHeld === 0) {
          throw new BadRequestException('Winners have not been drawn yet.');
        }
      }
    }

    if (rewardType === RewardType.INVITE_CODE_FCFS) {
      const maxW = quest.maxWinners ?? 0;
      const claimed = await this.prisma.winnerDraw.count({
        where: { questId, inviteCode: { not: null } },
      });
      const codesLeft = await this.countAvailableInviteCodes(questId);
      const remaining =
        maxW > 0 ? this.fcfsSlotsRemaining(maxW, claimed) : codesLeft;
      if (remaining <= 0 || codesLeft <= 0) {
        throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
      }
    }

    const feeCc = resolveClaimFeeCc(quest) ?? 2;
    const feeAlreadyPaid = Boolean(existingDraw?.claimFeeLedgerTxId);
    if (!feeAlreadyPaid) {
      const balance = await this.splice.getUserBalance(username);
      if (balance !== null && balance < feeCc) {
        throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
      }
    }

    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (!validatorPartyId) {
      throw new BadRequestException('Validator party is not configured on the server.');
    }

    let feeTxId: string;
    if (existingDraw?.claimFeeLedgerTxId) {
      feeTxId = existingDraw.claimFeeLedgerTxId;
    } else {
      try {
        feeTxId = await this.collectClaimFee({
          userId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'Claim fee',
          validatorPartyId,
        });
      } catch {
        throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
      }

      // Persist fee TX early so retries don't double-charge.
      await this.prisma.winnerDraw.upsert({
        where: { questId_userId: { questId, userId } },
        create: {
          questId,
          userId,
          ccAmount: quest.rewardCc,
          distributed: false,
          claimFeeLedgerTxId: feeTxId,
        },
        update: {
          claimFeeLedgerTxId: feeTxId,
        },
      });
    }

    // NEW: Determine claim kind for Code rewards (CODE_FCFS or CODE_RAFFLE)
    const codeClaimKind: 'CODE_FCFS' | 'CODE_RAFFLE' =
      rewardType === RewardType.INVITE_CODE_FCFS ? 'CODE_FCFS' : 'CODE_RAFFLE';

    // NEW: Create EarnClaimSession for Code reward audit trail (Canton M3 pattern)
    let earnClaimSessionId: string | null = null;
    if (this.questLedger.isClaimSessionConfigured()) {
      const ecs = await this.questLedger.createEarnClaimSession({
        userPartyId: cantonPartyId,
        campaignId: questId,
        claimKind: codeClaimKind,
        feeCc,
        rewardCc: 0, // Code rewards don't have CC amount
      });
      earnClaimSessionId = ecs.contractId;
      if (ecs.error) {
        this.logger.warn(`EarnClaimSession (${codeClaimKind}) create warning: ${ecs.error}`);
      }
    }

    // NEW: Mark EarnClaimSession fee paid for Code rewards
    if (earnClaimSessionId) {
      const earnFeeMarked = await this.questLedger.markEarnClaimFeePaid({
        sessionContractId: earnClaimSessionId,
        feeTxId,
      });
      if (!earnFeeMarked.ok) {
        this.logger.warn(`EarnClaimSession (${codeClaimKind}) fee mark failed: ${earnFeeMarked.errors.join(' | ')}`);
      }
    }

    // NEW: Create RaffleWinner on ledger for Code Raffle winner tracking
    if (this.questLedger.isConfigured() && codeClaimKind === 'CODE_RAFFLE') {
      const winnerRes = await this.questLedger.createRaffleWinner({
        userPartyId: cantonPartyId,
        campaignId: questId,
        rewardCc: 0,
      });
      if (winnerRes.error) {
        this.logger.warn(`RaffleWinner (CODE_RAFFLE) create warning: ${winnerRes.error}`);
      }
    }

    // NEW: Create FcfsSlotReservation on ledger for Code FCFS slot tracking
    if (this.questLedger.isConfigured() && codeClaimKind === 'CODE_FCFS') {
      const maxW = quest.maxWinners ?? 0;
      if (maxW > 0) {
        const slotIndex = await this.prisma.winnerDraw.count({
          where: { questId, inviteCode: { not: null } },
        });
        const expiresAt = new Date(Date.now() + this.fcfsReservationTtlMs()).toISOString();
        const slotRes = await this.questLedger.createFcfsSlotReservation({
          userPartyId: cantonPartyId,
          campaignId: questId,
          slotIndex,
          expiresAt,
        });
        if (slotRes.error) {
          this.logger.warn(`FcfsSlotReservation (CODE_FCFS) create warning: ${slotRes.error}`);
        }
      }
    }

    try {
      const codeRow = await this.prisma.inviteCodePool.findFirst({
        where: { questId, userId: null },
        orderBy: { createdAt: 'asc' },
      });
      if (!codeRow) {
        throw new BadRequestException('No invite codes available.');
      }

      await this.prisma.$transaction([
        this.prisma.inviteCodePool.update({
          where: { id: codeRow.id },
          data: { userId, assignedAt: new Date() },
        }),
        this.prisma.winnerDraw.upsert({
          where: { questId_userId: { questId, userId } },
          create: {
            questId,
            userId,
            ccAmount: quest.rewardCc,
            inviteCode: codeRow.code,
            distributed: true,
            claimFeeLedgerTxId: feeTxId,
          },
          update: {
            inviteCode: codeRow.code,
            distributed: true,
            claimFeeLedgerTxId: feeTxId,
          },
        }),
      ]);

      // NEW: Create CodeRewardEntitlement on ledger after code is assigned
      if (this.questLedger.isConfigured() && codeRow) {
        const entitlementRes = await this.questLedger.createCodeRewardEntitlement({
          userPartyId: cantonPartyId,
          campaignId: questId,
          code: codeRow.code,
          feeTxId,
          claimKind: codeClaimKind,
        });
        if (entitlementRes.error) {
          this.logger.warn(`CodeRewardEntitlement (${codeClaimKind}) create warning: ${entitlementRes.error}`);
        }
      }
    } catch (err) {
      this.logger.warn(`claimInviteReward DB failed: ${String(err)}`);
      throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
    }

    const rewardStatus = await this.getQuestRewardStatus(userId, questId);
    return {
      ok: true,
      message: `Your code is ready. (${feeCc} CC fee paid).`,
      inviteCode: (await this.prisma.winnerDraw.findUnique({ where: { questId_userId: { questId, userId } } }))?.inviteCode ?? null,
      feeCc,
      rewardStatus,
    };
  }

  /**
   * User → CANTON_VALIDATOR_PARTY_ID claim fee (offer/accept, same as Send CC).
   * Validator admin wallet must accept — NOT the claiming user.
   */
  /**
   * CC + Code combined raffle claim — winner pays 5 CC fee, receives CC reward + invite code.
   * Admin must have run Draw Winners first (sets WinnerDraw row).
   */
  async claimCcAndCodeRaffleReward(params: {
    userId: string;
    username: string | null;
    cantonPartyId: string | null;
    questId: string;
  }): Promise<{
    ok: boolean;
    message: string;
    rewardCc: number;
    inviteCode: string | null;
    feeCc: number;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
  }> {
    const { userId, questId, username, cantonPartyId } = params;
    if (!username?.trim() || !cantonPartyId?.trim()) {
      throw new BadRequestException('Create your Canton wallet before claiming.');
    }
    const quest = await this.prisma.quest.findUnique({ where: { id: questId } });
    if (!quest) throw new NotFoundException('Quest not found');
    if (!this.requiresCcAndCodeRaffleClaim(quest)) {
      throw new BadRequestException('This campaign does not use CC + Code combined raffle claim.');
    }
    const completion = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (!completion) {
      throw new BadRequestException('Submit the quest before claiming your reward.');
    }
    const draw = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (!draw) {
      throw new BadRequestException('You were not selected in the raffle draw.');
    }
    if (draw.distributed) {
      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      return {
        ok: true,
        message: draw.inviteCode
          ? `Already claimed: ${quest.rewardCc} CC + code ${draw.inviteCode}`
          : 'You already claimed this reward.',
        rewardCc: quest.rewardCc,
        inviteCode: draw.inviteCode,
        feeCc: 0,
        rewardStatus,
      };
    }
    const codesLeft = await this.countAvailableInviteCodes(questId);
    if (codesLeft <= 0) {
      throw new BadRequestException('No invite codes left in the pool. Contact support.');
    }
    const feeCc = resolveClaimFeeCc(quest) ?? 5;
    const rewardCc = quest.rewardCc;
    const validatorPartyId = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (!validatorPartyId) {
      throw new BadRequestException('Validator party is not configured on the server.');
    }
    const balance = await this.splice.getUserBalance(username);
    if (balance !== null && balance < feeCc) {
      throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
    }
    this.logger.log(
      `CC+Code raffle claim start quest=${questId} user=@${username} fee=${feeCc} reward=${rewardCc} CC + code`,
    );
    try {
      const feeTxId = await this.collectClaimFee({
        userId,
        username,
        questTitle: quest.title,
        feeCc,
        feeLabel: 'CC+Code raffle claim fee',
        validatorPartyId,
      });
      await this.assertValidatorRewardPool(rewardCc);
      let rewardOfferId: string | null = null;
      if (rewardCc > 0) {
        rewardOfferId = await this.splice.createTransferOffer(
          cantonPartyId,
          rewardCc,
          `CC+Code raffle reward — ${quest.title}`,
        );
        if (!rewardOfferId) throw new Error('CC reward offer failed');
        const rewardAccepted = await this.splice.acceptOfferViaWallet(rewardOfferId, username);
        if (!rewardAccepted) throw new Error('CC reward accept failed');
        await this.users.recordTransaction({
          userId,
          amountCc: rewardCc,
          type: 'QUEST_REWARD',
          description: `Received ${rewardCc} CC raffle reward`,
          referenceId: questId,
          counterparty: validatorPartyId.split('::')[0],
          ledgerTxId: rewardOfferId,
        });
        if (username) {
          await this.inboundSync.alignBalanceFromChain(userId, username);
        }
      }
      const codeRow = await this.prisma.inviteCodePool.findFirst({
        where: { questId, userId: null },
        orderBy: { createdAt: 'asc' },
      });
      if (!codeRow) {
        throw new Error('No invite codes available after fee was paid. Contact support.');
      }
      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.inviteCodePool.update({
          where: { id: codeRow.id },
          data: { userId, assignedAt: new Date() },
        }),
        this.prisma.winnerDraw.update({
          where: { id: draw.id },
          data: {
            distributed: true,
            ccAmount: rewardCc,
            inviteCode: codeRow.code,
            claimFeeLedgerTxId: feeTxId,
            ledgerTxId: rewardOfferId ?? undefined,
            distributedAt: new Date(),
          },
        }),
        this.prisma.questCompletion.upsert({
          where: { userId_questId: { userId, questId } },
          create: { userId, questId, rewardMicroCc, completedAt: completion.completedAt },
          update: { rewardMicroCc },
        }),
      ]);
      if (cantonPartyId && rewardOfferId) {
        void this.syncCampaignLedgerAfterPayout({
          userId, questId, userPartyId: cantonPartyId, rewardCc, payoutTxId: rewardOfferId,
        }).catch((err) => this.logger.warn(`CC+Code raffle ledger sync failed: ${String(err)}`));
      }
      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      return {
        ok: true,
        message: `Congratulations! ${rewardCc} CC sent to your wallet and your code is: ${codeRow.code}`,
        rewardCc,
        inviteCode: codeRow.code,
        feeCc,
        rewardStatus,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`CC+Code raffle claim failed: ${detail}`);
      throw new BadRequestException(this.fcfsClaimErrorMessage(detail));
    }
  }

  private async collectClaimFee(params: {
    userId: string;
    username: string;
    questTitle: string;
    feeCc: number;
    feeLabel: string;
    validatorPartyId: string;
  }): Promise<string> {
    const feeResult = await this.splice.collectClaimFeeToValidatorParty({
      senderUsername: params.username,
      feeCc: params.feeCc,
      description: `FCFS claim fee — ${params.questTitle}`,
      validatorPartyId: params.validatorPartyId,
    });

    if (!feeResult.collected) {
      throw new Error(feeResult.error ?? 'fee collect failed');
    }

    const ledgerTxId = feeResult.ledgerTxId ?? '';
    const validatorLabel = params.validatorPartyId.split('::')[0];
    await this.users.recordTransaction({
      userId: params.userId,
      amountCc: params.feeCc,
      type: 'TRANSFER_OUT',
      description: `Sent ${params.feeCc} CC claim fee`,
      counterparty: validatorLabel,
      ledgerTxId: ledgerTxId || undefined,
    });
    return ledgerTxId;
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
   * Leaderboard — satu rumus poin untuk weekly / monthly / all-time:
   * task earn + quest/campaign bonus + spin (points prize) + referral.
   */
  async getLeaderboard(
    period: 'weekly' | 'monthly' | 'all',
    page = 1,
    pageSize = 10,
  ): Promise<{ rows: LeaderboardRow[]; total: number; page: number; pageSize: number }> {
    const since = this.leaderboardSince(period);
    // Net points = earnPoints - spin cost spent (satu sumber kebenaran untuk leaderboard)
    const aggregated = await this.points.buildNetPointsByUser(since);
    const sorted = aggregated; // buildNetPointsByUser sudah sorted desc
    const total = sorted.length;
    const skip = (page - 1) * pageSize;
    const pageRows = sorted.slice(skip, skip + pageSize);

    const userIds = pageRows.map((u) => u.id);
    const profileRows = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        twitterUsername: true,
        cantonPartyId: true,
        twitterAvatarUrl: true,
      },
    });
    const profileByUser = new Map(profileRows.map((r) => [r.id, r]));

    const hydrated = await hydrateTwitterAvatarUrls(
      this.prisma,
      this.twitterApi,
      profileRows,
      this.logger,
    );

    const rows: LeaderboardRow[] = pageRows.map((row, i) => {
      const profile = profileByUser.get(row.id);
      return {
        rank: skip + i + 1,
        userId: row.id,
        username: row.username ?? profile?.username ?? 'unknown',
        displayName:
          row.displayName ?? profile?.displayName ?? row.username ?? 'Unknown',
        twitterUsername: profile?.twitterUsername ?? null,
        cantonPartyId: row.cantonPartyId ?? profile?.cantonPartyId ?? null,
        points: row.points,
        avatarUrl: profile
          ? (hydrated.get(profile.id) ?? resolvePublicAvatarUrl(profile))
          : null,
      };
    });

    return { rows, total, page, pageSize };
  }

  private leaderboardSince(period: 'weekly' | 'monthly' | 'all'): Date | undefined {
    if (period === 'all') return undefined;
    const now = Date.now();
    const ms =
      period === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    return new Date(now - ms);
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
    const [submissions, txs, completions, spinWins, referrals] = await Promise.all([
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
      this.prisma.spinResult.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: fetchCap,
        include: { spinItem: { select: { label: true, rewardType: true, rewardPoints: true } } },
      }),
      this.prisma.referralReward.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        take: fetchCap,
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

    for (const r of spinWins) {
      if (r.spinItem.rewardType !== 'points' || (r.spinItem.rewardPoints ?? 0) <= 0) {
        continue;
      }
      items.push({
        type: 'task_verified',
        title: 'Spin reward',
        detail: `${r.spinItem.label} · +${r.spinItem.rewardPoints} pts`,
        time: r.createdAt.toISOString(),
      });
    }

    for (const ref of referrals) {
      items.push({
        type: 'task_verified',
        title: 'Referral reward',
        detail: `Friend verified · +${ref.points} pts`,
        time: ref.createdAt.toISOString(),
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
