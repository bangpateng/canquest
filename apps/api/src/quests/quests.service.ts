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
  EntryGateMode,
  normalizeEntryGateMode,
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
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { LockEligibilityService } from '../canton/lock-eligibility.service';
import { ProfileAvatarService } from '../users/profile-avatar.service';
import { resolvePublicAvatarUrl } from '../users/user-avatar-url';
import { PointsService } from '../users/points.service';
import { UsersService } from '../users/users.service';
import { hydrateTwitterAvatarUrls } from '../twitter/hydrate-twitter-avatars';
import { TwitterApiService } from '../twitter/twitter-api.service';
import { TwitterCacheService } from '../twitter/twitter-cache.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { withQuestMediaUrls } from '../storage/quest-media.util';
import { parseQuestSocialLinks } from './quest-social-links.util';
import { isFeeTransactionRow } from '../users/cc-transaction-visibility';
import {
  startOfTodayUtc,
  msUntilNextUtcDay,
} from '../common/time-utils';
import {
  normalizeCantonPartyId,
  cantonPartyIdsEqual,
} from '../common/canton-party-id';

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
  /** Lifetime points spent on Earn entries (method='points'). */
  pointsSpent: number;
  /** Net spendable points = lifetime earned - spent. */
  pointsRemaining: number;
  /** Completions of EARN_HUB quests (the Quest hub menu). */
  earnHubCompleted: number;
  /** Completions of CAMPAIGN quests (the Earn menu). */
  campaignCompleted: number;
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
    private readonly cantonLedger: CantonLedgerService,
    private readonly avatars: ProfileAvatarService,
    private readonly users: UsersService,
    private readonly points: PointsService,
    private readonly twitterApi: TwitterApiService,
    private readonly twitterCache: TwitterCacheService,
    private readonly splice: SpliceValidatorService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly config: ConfigService,
    private readonly storage: R2StorageService,
    private readonly lockEligibility: LockEligibilityService,
  ) {}

  /** Default biaya poin ikut Earn (jalur method='points'). Bisa di-override via AppSetting/env. */
  private static readonly EARN_ENTRY_COST_DEFAULT = 200;

  /**
   * Resolve biaya poin untuk ikut satu campaign Earn.
   * Prioritas (paling dinamis → paling statis):
   *   1. AppSetting `earn_entry_cost_points` (DB) — bisa diubah live tanpa restart.
   *   2. env `EARN_ENTRY_COST_POINTS` — perlu restart API.
   *   3. Default 200.
   */
  private async resolveEarnEntryCostPoints(): Promise<number> {
    // 1. Cek AppSetting di DB (live, tanpa restart).
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: 'earn_entry_cost_points' },
    });
    if (setting) {
      const val = parseInt(setting.value, 10);
      if (Number.isFinite(val) && val > 0) return val;
    }
    // 2. Fallback ke env.
    const envVal = Number(
      this.config.get<string>('EARN_ENTRY_COST_POINTS') ?? '',
    );
    if (Number.isFinite(envVal) && envVal > 0) return Math.round(envVal);
    // 3. Default.
    return QuestsService.EARN_ENTRY_COST_DEFAULT;
  }

  /**
   * Default global CC lock amount (env LOCK_TIER_FULL, default 30).
   * Dipakai sebagai fallback bila quest tidak override entryCcLock.
   */
  private resolveGlobalCcLockAmount(): number {
    return Number(this.config.get<string>('LOCK_TIER_FULL') ?? '30');
  }

  /**
   * Resolve gate akses Earn untuk satu quest (per-event override → fallback global).
   * Null/undefined pada quest = pakai default global (backward-compatible).
   */
  async resolveQuestEntryGate(quest: {
    entryGateMode?: string | null;
    entryCcLock?: number | null;
    entryCostPoints?: number | null;
  }): Promise<{
    mode: EntryGateMode;
    ccLockAmount: number;
    costPoints: number;
  }> {
    const mode = normalizeEntryGateMode(quest.entryGateMode ?? null);
    // Override per-event jika admin set nilai > 0; else fallback global.
    const overrideCc = Number(quest.entryCcLock);
    const ccLockAmount =
      Number.isFinite(overrideCc) && overrideCc > 0
        ? Math.floor(overrideCc)
        : this.resolveGlobalCcLockAmount();
    const overridePts = Number(quest.entryCostPoints);
    const costPoints =
      Number.isFinite(overridePts) && overridePts > 0
        ? Math.floor(overridePts)
        : await this.resolveEarnEntryCostPoints();
    return { mode, ccLockAmount, costPoints };
  }

  /**
   * Gate akses campaign Earn (per-campaign, first participation).
   * Mode gate di-set per-event admin (entryGateMode):
   *   - CC_OR_POINTS (default): lock ≥ {ccLockAmount} CC ATAU spend {costPoints} points.
   *   - CC_ONLY: hanya lock CC.
   *   - POINTS_ONLY: hanya spend points.
   *   - NONE: tanpa gate (event gratis) — langsung catat entry tanpa syarat.
   * Dipasang di submitTask: dicek hanya saat user belum punya EarnEntry maupun
   * submission untuk campaign ini. Pencatatan EarnEntry atomik via upsert idempoten.
   */
  private async ensureEarnEntry(params: {
    userId: string;
    userPartyId: string | null;
    questId: string;
    quest: {
      entryGateMode?: string | null;
      entryCcLock?: number | null;
      entryCostPoints?: number | null;
    };
  }): Promise<void> {
    const { mode, ccLockAmount, costPoints } = await this.resolveQuestEntryGate(
      params.quest,
    );

    // NONE = tanpa gate → catat entry gratis (method 'none') tanpa syarat.
    if (mode === EntryGateMode.NONE) {
      await this.prisma.earnEntry.upsert({
        where: {
          userId_questId: { userId: params.userId, questId: params.questId },
        },
        create: {
          userId: params.userId,
          questId: params.questId,
          method: 'none',
          pointsSpent: 0,
        },
        update: {},
      });
      return;
    }

    // Sudah ada entry → gate sudah dilewati sebelumnya.
    const existing = await this.prisma.earnEntry.findUnique({
      where: {
        userId_questId: { userId: params.userId, questId: params.questId },
      },
    });
    if (existing) return;

    // Jalur CC lock aktif untuk mode CC_OR_POINTS dan CC_ONLY.
    const ccGateActive =
      mode === EntryGateMode.CC_OR_POINTS || mode === EntryGateMode.CC_ONLY;
    if (ccGateActive && params.userPartyId) {
      const lockedCc = await this.lockEligibility.lockedCcOf(
        params.userPartyId,
      );
      if (lockedCc >= ccLockAmount) {
        // Catat entry cc_lock. ccLockedMicro = 0 di sini karena jumlah lock dibaca
        // on-chain (sumber kebenaran); EarnEntry hanya penanda method akses.
        await this.prisma.earnEntry.upsert({
          where: {
            userId_questId: { userId: params.userId, questId: params.questId },
          },
          create: {
            userId: params.userId,
            questId: params.questId,
            method: 'cc_lock',
            pointsSpent: 0,
          },
          update: {},
        });
        return;
      }
    }

    // Jalur points aktif untuk mode CC_OR_POINTS dan POINTS_ONLY.
    const pointsGateActive =
      mode === EntryGateMode.CC_OR_POINTS || mode === EntryGateMode.POINTS_ONLY;
    if (pointsGateActive) {
      // Cek saldo net, debit via EarnEntry dalam transaksi (anti double-charge).
      const netPoints = await this.points.getNetPoints(params.userId);
      if (netPoints >= costPoints) {
        await this.prisma.$transaction(async (tx) => {
          // Lock row-level: re-cek EarnEntry di dalam tx agar dua request paralel
          // tidak sama-sama lolos dan menulis dua debit.
          const again = await tx.earnEntry.findUnique({
            where: {
              userId_questId: {
                userId: params.userId,
                questId: params.questId,
              },
            },
          });
          if (again) return;
          await tx.earnEntry.create({
            data: {
              userId: params.userId,
              questId: params.questId,
              method: 'points',
              pointsSpent: costPoints,
            },
          });
        });
        return;
      }
      // Saldo points tidak cukup → gagal dgn pesan sesuai mode.
      if (mode === EntryGateMode.POINTS_ONLY) {
        throw new BadRequestException(
          `Spend ${costPoints} pts to join. You currently have ${netPoints} pts.`,
        );
      }
      throw new BadRequestException(
        `Unlock Earn with ${costPoints} pts or ${ccLockAmount} CC. You currently have ${netPoints} pts.`,
      );
    }

    // Mode CC_ONLY dan user tidak memenuhi syarat CC lock.
    throw new BadRequestException(
      `Lock ${ccLockAmount} CC to join this event.`,
    );
  }

  /**
   * Cek eligibility user untuk satu campaign (READ-ONLY, tidak throw, tidak debit).
   * Dipakai badge FE untuk menampilkan "Eligible / Not eligible" + alasan.
   * Mencerminkan logika ensureEarnEntry tanpa side-effect.
   */
  async getQuestEligibility(
    userId: string,
    questId: string,
    userPartyId: string | null,
  ): Promise<{
    eligible: boolean;
    mode: EntryGateMode;
    ccLockAmount: number;
    entryCostPoints: number;
    lockedCc: number;
    netPoints: number;
    hasEntry: boolean;
    reason: string;
  }> {
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      select: {
        questKind: true,
        entryGateMode: true,
        entryCcLock: true,
        entryCostPoints: true,
      },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    // Bukan CAMPAIGN (mis. EARN_HUB) → tidak ada gate, selalu eligible.
    if (quest.questKind !== QuestKind.CAMPAIGN) {
      return {
        eligible: true,
        mode: EntryGateMode.NONE,
        ccLockAmount: 0,
        entryCostPoints: 0,
        lockedCc: 0,
        netPoints: 0,
        hasEntry: false,
        reason: 'No access gate for this quest.',
      };
    }

    const { mode, ccLockAmount, costPoints } =
      await this.resolveQuestEntryGate(quest);

    // Sudah punya entry? → gate sudah dilewati.
    const existing = await this.prisma.earnEntry.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (existing) {
      return {
        eligible: true,
        mode,
        ccLockAmount,
        entryCostPoints: costPoints,
        lockedCc: 0,
        netPoints: 0,
        hasEntry: true,
        reason: 'Access already unlocked for this event.',
      };
    }

    // NONE = tanpa gate.
    if (mode === EntryGateMode.NONE) {
      return {
        eligible: true,
        mode,
        ccLockAmount: 0,
        entryCostPoints: 0,
        lockedCc: 0,
        netPoints: 0,
        hasEntry: false,
        reason: 'Free event — no access requirement.',
      };
    }

    // Hitung sekali: jumlah CC terkunci + saldo net points.
    const [lockedCc, netPoints] = await Promise.all([
      userPartyId
        ? this.lockEligibility.lockedCcOf(userPartyId)
        : Promise.resolve(0),
      this.points.getNetPoints(userId),
    ]);

    const ccOk = lockedCc >= ccLockAmount;
    const pointsOk = netPoints >= costPoints;

    // CC_OR_POINTS: cukup salah satu.
    if (mode === EntryGateMode.CC_OR_POINTS) {
      const eligible = ccOk || pointsOk;
      return {
        eligible,
        mode,
        ccLockAmount,
        entryCostPoints: costPoints,
        lockedCc,
        netPoints,
        hasEntry: false,
        reason: eligible
          ? 'You meet the access requirement.'
          : `Lock ${ccLockAmount} CC or spend ${costPoints} pts. You have ${lockedCc} CC and ${netPoints} pts.`,
      };
    }

    // CC_ONLY: hanya CC lock.
    if (mode === EntryGateMode.CC_ONLY) {
      return {
        eligible: ccOk,
        mode,
        ccLockAmount,
        entryCostPoints: costPoints,
        lockedCc,
        netPoints,
        hasEntry: false,
        reason: ccOk
          ? 'You meet the CC lock requirement.'
          : `Lock ${ccLockAmount} CC to join. You currently have ${lockedCc} CC locked.`,
      };
    }

    // POINTS_ONLY: hanya points.
    return {
      eligible: pointsOk,
      mode,
      ccLockAmount,
      entryCostPoints: costPoints,
      lockedCc,
      netPoints,
      hasEntry: false,
      reason: pointsOk
        ? 'You have enough points to join.'
        : `Spend ${costPoints} pts to join. You currently have ${netPoints} pts.`,
    };
  }

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
    if (
      normalizeRewardType(quest.rewardType as RewardType) !== RewardType.CC_ONLY
    ) {
      return false;
    }
    if (
      quest.questKind === QuestKind.CAMPAIGN ||
      quest.questKind === 'CAMPAIGN'
    ) {
      return true;
    }
    return (quest.maxWinners ?? 0) > 0;
  }

  /** CC raffle (admin type "5 · Token CC manual"): admin draw after event; winners claim CC. */
  requiresDrawCcClaim(quest: { rewardType: RewardType | string }): boolean {
    return (
      normalizeRewardType(quest.rewardType as RewardType) ===
      RewardType.CC_MANUAL
    );
  }

  /** CC + Code combined raffle: admin draw after event; winners claim both CC and invite code. */
  requiresCcAndCodeRaffleClaim(quest: {
    rewardType: RewardType | string;
  }): boolean {
    return (
      normalizeRewardType(quest.rewardType as RewardType) ===
      RewardType.CC_AND_CODE_RAFFLE
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
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
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
        redeemUrl: null as string | null,
        redeemInstructions: null as string | null,
      };
    }
    const maxWinners = quest.maxWinners;
    let remainingSlots: number | null = null;
    let slotsTaken: number | null = null;
    let slotsFull = false;
    if (maxWinners != null && maxWinners > 0) {
      const isCodeFcfs =
        normalizeRewardType(quest.rewardType) === RewardType.INVITE_CODE_FCFS;
      if (isCodeFcfs) {
        const codesAssigned = await this.prisma.inviteCodePool.count({
          where: { questId, userId: { not: null } },
        });
        remainingSlots = this.fcfsSlotsRemaining(maxWinners, codesAssigned);
        slotsTaken = codesAssigned;
        slotsFull = remainingSlots <= 0;
      } else {
        await this.releaseStaleFcfsReservations(questId);
        const used = await this.countFcfsSlotsTaken(questId);
        remainingSlots = this.fcfsSlotsRemaining(maxWinners, used);
        slotsTaken = used;
        slotsFull = remainingSlots <= 0;
      }
    }
    const endRaw = quest.endsAt ?? quest.deadline ?? null;
    const end =
      endRaw instanceof Date ? endRaw : endRaw ? new Date(endRaw) : null;
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
      redeemUrl: quest.redeemUrl ?? null,
      redeemInstructions: quest.redeemInstructions ?? null,
    };
  }

  private async countAvailableInviteCodes(questId: string): Promise<number> {
    return this.prisma.inviteCodePool.count({
      where: { questId, userId: null },
    });
  }

  private fcfsReservationTtlMs(): number {
    return Number(
      this.config.get<string>('FCFS_RESERVATION_TTL_MS') ?? '300000',
    );
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

  private countFcfsSlotsTaken(
    questId: string,
    tx: PrismaTx | PrismaService = this.prisma,
  ) {
    return tx.winnerDraw.count({ where: { questId } });
  }

  private fcfsClaimLockKey(questId: string, userId: string): string {
    return `${questId}:${userId}`;
  }

  /** DB + memory lock so one user cannot run two on-chain claims at once.
   *  Applies to ALL claim kinds (FCFS, Draw CC, CC+Code raffle). */
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
        OR: [
          { fcfsClaimLockedAt: null },
          { fcfsClaimLockedAt: { lt: staleCutoff } },
        ],
      },
      data: { fcfsClaimLockedAt: new Date() },
    });
    if (updated.count !== 1) {
      return false;
    }
    this.fcfsClaimInFlight.add(memKey);
    return true;
  }

  private releaseFcfsOnChainLock(
    questId: string,
    userId: string,
    drawId: string,
  ): void {
    this.fcfsClaimInFlight.delete(this.fcfsClaimLockKey(questId, userId));
    void this.prisma.winnerDraw
      .updateMany({
        where: { id: drawId, distributed: false },
        data: { fcfsClaimLockedAt: null },
      })
      .catch(() => {});
  }

  /** Resolve the Splice username for reward sending (canquest-reward wallet). */
  private get rewardSenderUsername(): string {
    return (
      this.config.get<string>('CANTON_REWARD_API_USER')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER')?.trim() ||
      'administrator'
    );
  }

  /** Resolve the reward party ID for sending rewards. */
  private get rewardPartyId(): string | null {
    return (
      this.config.get<string>('CANTON_REWARD_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ||
      null
    );
  }

  /** Resolve the fee target party ID (fee recipient). */
  private get feeTargetPartyId(): string | null {
    return (
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_FEE_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ||
      null
    );
  }

  /** Ensure reward wallet (canquest-reward) can cover the payout before sending. */
  private async assertRewardPool(rewardCc: number): Promise<void> {
    const rewardUsername = this.rewardSenderUsername;
    const balance = await this.splice.getUserBalance(rewardUsername);
    if (balance !== null && balance < rewardCc) {
      throw new Error(
        `Reward wallet too low (@${rewardUsername} has ${balance.toFixed(2)} CC, need ${rewardCc} CC)`,
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

  /**
   * Atomically reserve one invite code for a user.
   *
   * Uses SELECT ... FOR UPDATE SKIP LOCKED inside an interactive transaction so
   * concurrent claimants are serialised: only one of them takes each code row,
   * the next skips the locked row and takes the following free code. Returns
   * the assigned code, or null if the pool is exhausted.
   *
   * The previous findFirst+update pattern had a TOCTOU race: two parallel
   * claims read the same free row, then the second upsert silently overwrote
   * the first assignment — one code leaked and was mis-attributed.
   */
  private async reserveInviteCode(
    questId: string,
    userId: string,
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const free = await tx.$queryRaw<{ id: string; code: string }[]>`
        SELECT id, code FROM "InviteCodePool"
        WHERE "questId" = ${questId} AND "userId" IS NULL
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (free.length === 0) return null;
      await tx.inviteCodePool.update({
        where: { id: free[0].id },
        data: { userId, assignedAt: new Date() },
      });
      return free[0].code;
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
          rewardType: normalizeRewardType(q.rewardType),
          status: resolveQuestDisplayStatus(q),
        },
        this.storage,
      ),
    );
    const withSummary = await this.attachCampaignSummaries(mapped);
    const withStatus = withSummary.map((q) => this.applyCampaignListStatus(q));
    return status ? withStatus.filter((q) => q.status === status) : withStatus;
  }

  /** FCFS campaigns with no slots left surface as ENDED (Earn tabs + detail header). */
  private applyCampaignListStatus<
    T extends {
      status: QuestStatus;
      rewardType?: RewardType | string;
      campaignSummary?: QuestCampaignSummary;
    },
  >(q: T): T {
    const rt = q.rewardType
      ? normalizeRewardType(q.rewardType as RewardType)
      : null;
    const isCodeFcfs = rt === RewardType.INVITE_CODE_FCFS;
    const codeSlotsFull =
      isCodeFcfs &&
      q.status === QuestStatus.ACTIVE &&
      (q.campaignSummary?.slotsFull ||
        (q.campaignSummary?.codesRemaining != null &&
          q.campaignSummary.codesRemaining <= 0 &&
          (q.campaignSummary?.slotsTaken ?? 0) > 0));
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
    // For INVITE_CODE_FCFS: count CODES THAT HAVE BEEN ASSIGNED (userId not null)
    const assignedCodesByQuest: Record<string, number> = {};
    if (inviteFcfsIds.length > 0) {
      const assignedCounts = await this.prisma.inviteCodePool.groupBy({
        by: ['questId'],
        where: { questId: { in: inviteFcfsIds }, userId: { not: null } },
        _count: { _all: true },
      });
      for (const row of assignedCounts) {
        assignedCodesByQuest[row.questId] = row._count._all;
      }
    }

    // Available (unassigned) codes — for codesRemaining display
    const availableCodesByQuest: Record<string, number> = {};
    if (inviteFcfsIds.length > 0) {
      const availableCounts = await this.prisma.inviteCodePool.groupBy({
        by: ['questId'],
        where: { questId: { in: inviteFcfsIds }, userId: null },
        _count: { _all: true },
      });
      for (const row of availableCounts) {
        availableCodesByQuest[row.questId] = row._count._all;
      }
    }

    const isInviteCodeFcfs = (q: { rewardType: RewardType | string }) =>
      normalizeRewardType(q.rewardType as RewardType) ===
      RewardType.INVITE_CODE_FCFS;

    return quests.map((q) => {
      const maxWinners = q.maxWinners;
      const isCodeFcfs = isInviteCodeFcfs(q);
      // For INVITE_CODE_FCFS: slots taken = number of codes already assigned to users.
      const taken = isCodeFcfs
        ? (assignedCodesByQuest[q.id] ?? 0)
        : (takenByQuest[q.id] ?? 0);
      const remainingSlots =
        maxWinners != null && maxWinners > 0
          ? this.fcfsSlotsRemaining(maxWinners, taken)
          : null;
      const slotsTaken = maxWinners != null && maxWinners > 0 ? taken : null;
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
            ? (availableCodesByQuest[q.id] ?? 0)
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
      rewardType: normalizeRewardType(q.rewardType),
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
        rewardType: normalizeRewardType(q.rewardType),
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
    const sendProgress = await this.buildSendTransactionProgress(
      userId,
      questId,
    );
    // Per-day progress for daily (repeatable) tasks: taskIds whose submission
    // was verified during the current UTC day. The frontend uses this to render
    // an accurate "today's progress" bar that resets at 00:00 UTC, instead of
    // the all-time VERIFIED status (which stays true forever and was misleading).
    const todayStart = startOfTodayUtc();
    const todayVerifiedTaskIds = submissions
      .filter((s) => s.verifiedAt && s.verifiedAt >= todayStart)
      .map((s) => s.taskId);
    return {
      completed,
      allTasksVerified,
      submissions,
      rewardStatus,
      rewardCc: completion ? Number(completion.rewardMicroCc) / 1_000_000 : 0,
      cantonLedgerConfigured: this.questLedger.isConfigured(),
      ledger: completion ? this.ledgerFromCompletion(completion) : null,
      campaignMeta,
      sendProgress,
      todayVerifiedTaskIds,
    };
  }

  /**
   * Live progress for send/receive tasks: { [taskId]: { required, today } }.
   * `today` counts real on-chain activity since 00:00 UTC (daily reset).
   * Used by the Quest UI to show "3/5 sends".
   */
  private async buildSendTransactionProgress(
    userId: string,
    questId: string,
  ): Promise<Record<string, { required: number; today: number }>> {
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      select: { tasks: { select: { id: true, type: true, target: true } } },
    });
    const all = quest?.tasks ?? [];
    const windowStart = startOfTodayUtc();

    // Group countable wallet tasks by type so we run at most one query per type.
    const byType: Record<string, typeof all> = {};
    for (const t of all) {
      const nt = this.normalizeTaskType(t.type);
      if (
        nt === 'send_transaction' ||
        nt === 'send_token' ||
        nt === 'daily_swap' ||
        nt === 'send_any_daily' ||
        nt === 'send_to_user_daily' ||
        nt === 'receive_external_daily' ||
        nt === 'receive_internal_daily'
      ) {
        (byType[nt] ??= []).push(t);
      }
    }
    if (Object.keys(byType).length === 0) return {};

    const [
      ccSends,
      tokenSends,
      swaps,
      sendAny,
      sendToUser,
      receiveExternal,
      receiveInternal,
    ] = await Promise.all([
      byType['send_transaction']?.length
        ? this.countRecentUserSends(userId, windowStart)
        : Promise.resolve(0),
      byType['send_token']?.length
        ? this.countRecentUserTokenSends(userId, windowStart)
        : Promise.resolve(0),
      byType['daily_swap']?.length
        ? this.countRecentUserSwaps(userId, windowStart)
        : Promise.resolve(0),
      byType['send_any_daily']?.length
        ? this.countSendAnyToday(userId, windowStart)
        : Promise.resolve(0),
      byType['send_to_user_daily']?.length
        ? this.countSendToUserToday(userId, windowStart)
        : Promise.resolve(0),
      byType['receive_external_daily']?.length
        ? this.countReceiveExternalToday(userId, windowStart, undefined)
        : Promise.resolve(0),
      byType['receive_internal_daily']?.length
        ? this.countReceiveInternalToday(userId, windowStart)
        : Promise.resolve(0),
    ]);

    const counts: Record<string, number> = {
      send_transaction: ccSends,
      send_token: tokenSends,
      daily_swap: swaps,
      send_any_daily: sendAny,
      send_to_user_daily: sendToUser,
      receive_external_daily: receiveExternal,
      receive_internal_daily: receiveInternal,
    };

    const result: Record<string, { required: number; today: number }> = {};
    for (const [nt, tasks] of Object.entries(byType)) {
      for (const t of tasks) {
        result[t.id] = {
          required: this.parseSendTransactionRequired(t.target),
          today: counts[nt] ?? 0,
        };
      }
    }
    return result;
  }

  /** Map stored completion row → API ledger proof (survives page reload). */
  private ledgerFromCompletion(completion: {
    ledgerParticipationId: string | null;
    ledgerRewardId: string | null;
    ledgerTaskSubmissionIds: unknown;
  }): QuestLedgerSubmitResult {
    const taskSubmissionIds = this.parseLedgerTaskIds(
      completion.ledgerTaskSubmissionIds,
    );
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
        this.logger.warn(
          `QuestReward mark claimed: ${marked.errors.join(' | ')}`,
        );
      }
    }
  }

  private parseLedgerTaskIds(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      );
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
        entryGateMode: true,
        entryCcLock: true,
        entryCostPoints: true,
      },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    if (quest.questKind === QuestKind.CAMPAIGN && this.isCampaignEnded(quest)) {
      throw new BadRequestException(
        'This campaign has ended. Submissions are closed.',
      );
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
    const isSendTxTask = taskType === 'send_transaction';
    const isSendTokenTask = taskType === 'send_token';
    const isDailySwapTask = taskType === 'daily_swap';
    const isLockCcTask = taskType === 'lock_cc';
    // Daily tasks that repeat once per UTC day (reset at 00:00 UTC).
    const isSendAnyDailyTask = taskType === 'send_any_daily';
    const isSendToUserDailyTask = taskType === 'send_to_user_daily';
    const isReceiveExternalDailyTask = taskType === 'receive_external_daily';
    const isReceiveInternalDailyTask = taskType === 'receive_internal_daily';
    const repeatable24h =
      quest.questKind === QuestKind.EARN_HUB &&
      (taskType === 'daily_check_in' ||
        isSendTxTask ||
        isSendTokenTask ||
        isDailySwapTask ||
        isSendAnyDailyTask ||
        isSendToUserDailyTask ||
        isReceiveExternalDailyTask ||
        isReceiveInternalDailyTask);

    // Gate akses Earn: per-campaign, first participation. CAMPAIGN saja (bukan EARN_HUB).
    if (quest.questKind === QuestKind.CAMPAIGN) {
      await this.ensureEarnEntry({ userId, userPartyId, questId, quest });
    }

    const existing = await this.prisma.questSubmission.findUnique({
      where: { userId_taskId: { userId, taskId } },
    });
    if (existing) {
      if (existing.status === SubmissionStatus.VERIFIED) {
        if (repeatable24h) {
          // Daily reset anchored to 00:00 UTC. A repeat is allowed once the
          // user's last verification falls before today's UTC midnight.
          const lastAt = existing.verifiedAt ?? existing.submittedAt;
          const todayStart = startOfTodayUtc();
          if (lastAt && lastAt >= todayStart) {
            const msLeft = msUntilNextUtcDay();
            const hoursLeft = Math.max(
              1,
              Math.ceil(msLeft / (60 * 60 * 1000)),
            );
            throw new BadRequestException(
              `Already completed today — resets in ~${hoursLeft}h at 00:00 UTC.`,
            );
          }

          // Send-transaction: require a real wallet + enough real CC sends today.
          if (isSendTxTask) {
            const result = await this.verifySendTransactionTask({
              userId,
              userPartyId,
              requiredCount: this.parseSendTransactionRequired(task.target),
            });
            if (!result.ok) {
              throw new BadRequestException(result.message);
            }
          }

          // Send-token: require a real wallet + enough real USDCx sends today.
          if (isSendTokenTask) {
            const result = await this.verifySendTokenTask({
              userId,
              userPartyId,
              requiredCount: this.parseSendTransactionRequired(task.target),
            });
            if (!result.ok) {
              throw new BadRequestException(result.message);
            }
          }

          // Daily-swap: require a real wallet + enough real swaps today.
          if (isDailySwapTask) {
            const result = await this.verifyDailySwapTask({
              userId,
              userPartyId,
              requiredCount: this.parseSendTransactionRequired(task.target),
            });
            if (!result.ok) {
              throw new BadRequestException(result.message);
            }
          }

          // New daily send/receive variants (CC + USDCx, internal vs external).
          if (isSendAnyDailyTask) {
            const result = await this.verifySendAnyDaily({
              userId,
              userPartyId,
              requiredCount: this.parseSendTransactionRequired(task.target),
            });
            if (!result.ok) {
              throw new BadRequestException(result.message);
            }
          }
          if (isSendToUserDailyTask) {
            const result = await this.verifySendToUserDaily({
              userId,
              userPartyId,
              requiredCount: this.parseSendTransactionRequired(task.target),
            });
            if (!result.ok) {
              throw new BadRequestException(result.message);
            }
          }
          if (isReceiveExternalDailyTask) {
            const result = await this.verifyReceiveExternalDaily({
              userId,
              userPartyId,
              requiredCount: this.parseSendTransactionRequired(task.target),
            });
            if (!result.ok) {
              throw new BadRequestException(result.message);
            }
          }
          if (isReceiveInternalDailyTask) {
            const result = await this.verifyReceiveInternalDaily({
              userId,
              userPartyId,
              requiredCount: this.parseSendTransactionRequired(task.target),
            });
            if (!result.ok) {
              throw new BadRequestException(result.message);
            }
          }

          const now = new Date();
          await this.prisma.questSubmission.update({
            where: { id: existing.id },
            data: {
              proof:
                proof?.trim() ||
                (isSendTxTask
                  ? 'sent_tx'
                  : isSendTokenTask
                    ? 'sent_token'
                    : isDailySwapTask
                      ? 'swapped'
                      : isSendAnyDailyTask
                        ? 'sent_any'
                        : isSendToUserDailyTask
                          ? 'sent_to_user'
                          : isReceiveExternalDailyTask
                            ? 'received_external'
                            : isReceiveInternalDailyTask
                              ? 'received_internal'
                              : 'checked_in'),
              verifiedAt: now,
              submittedAt: now,
            },
          });
          await this.users.creditEarnPoints(userId, task.points);
          // canquest-v21: daily check-in sepenuhnya off-chain (Postgres QuestSubmission
          // unik + reset 00:00 UTC). Template DailyCheckIn dihapus dari DAML (redundan).
          this.logger.log(
            `Task re-submitted (daily repeat): user=${userId.slice(0, 8)} task=${taskId}`,
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
      (taskType === 'submit_party_id' ||
        taskType === 'submit_canton_address') &&
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
        throw new BadRequestException(
          'Incorrect answer. No points awarded — try again.',
        );
      }
    }

    if (taskType === 'twitter_follow' || taskType === 'twitter_retweet') {
      await this.verifyTwitterTaskForUser(
        userId,
        taskId,
        taskType,
        task.target,
      );
    }

    // Send-transaction (first-time): require wallet + enough real CC sends in the last 24h.
    if (isSendTxTask) {
      const result = await this.verifySendTransactionTask({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'sent_tx';
    }

    // Send-token (first-time): require wallet + enough real USDCx sends in 24h.
    if (isSendTokenTask) {
      const result = await this.verifySendTokenTask({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'sent_token';
    }

    // Daily-swap (first-time): require wallet + enough real swaps in 24h.
    if (isDailySwapTask) {
      const result = await this.verifyDailySwapTask({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'swapped';
    }

    // Lock-CC (first-time): require wallet + a qualifying lock; cascade lower tiers.
    // The current task's submission is created by the generic path below with
    // proof 'locked_cc'; cascaded siblings get their own VERIFIED rows + points
    // inside verifyLockCcTask().
    if (isLockCcTask) {
      const result = await this.verifyLockCcTask({
        userId,
        userPartyId,
        questId,
        taskId,
        target: task.target,
        points: task.points,
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'locked_cc';
    }

    // New daily send/receive variants (first-time): same verification as the
    // repeat path — count real on-chain activity since 00:00 UTC.
    if (isSendAnyDailyTask) {
      const result = await this.verifySendAnyDaily({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'sent_any';
    }
    if (isSendToUserDailyTask) {
      const result = await this.verifySendToUserDaily({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'sent_to_user';
    }
    if (isReceiveExternalDailyTask) {
      const result = await this.verifyReceiveExternalDaily({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'received_external';
    }
    if (isReceiveInternalDailyTask) {
      const result = await this.verifyReceiveInternalDaily({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'received_internal';
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
        status: autoVerify
          ? SubmissionStatus.VERIFIED
          : SubmissionStatus.PENDING,
        verifiedAt: autoVerify ? new Date() : null,
      },
    });

    if (autoVerify) {
      await this.users.creditEarnPoints(userId, task.points);
    }

    if (autoVerify && userPartyId && this.questLedger.isConfigured()) {
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
    if (existing)
      return { justCompleted: false, rewardMicroCc: existing.rewardMicroCc };

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

    const rewardType = normalizeRewardType(quest.rewardType);
    let rewardCc = 0;
    if (
      rewardType === RewardType.CC_ONLY ||
      rewardType === RewardType.CC_AND_INVITE
    ) {
      rewardCc = quest.rewardCc;
    }

    let inviteCode: string | null = null;
    const needsInvite =
      rewardType === RewardType.INVITE_CODE_FCFS ||
      rewardType === RewardType.CC_AND_INVITE;

    if (needsInvite && quest.maxWinners && !requiresPaidInviteClaim(quest)) {
      const slotsUsed = await this.prisma.winnerDraw.count({
        where: { questId },
      });
      if (slotsUsed < quest.maxWinners) {
        // Atomically reserve a code. The previous findFirst+update pattern had
        // a TOCTOU race: two parallel submissions read the same free row, then
        // the second upsert silently overwrote the first assignment (code leak
        // + mis-attribution). See reserveInviteCode for the lock strategy.
        try {
          const claimedCode = await this.reserveInviteCode(questId, userId);
          if (claimedCode) {
            inviteCode = claimedCode;
            await this.prisma.winnerDraw.upsert({
              where: { questId_userId: { questId, userId } },
              create: {
                questId,
                userId,
                ccAmount: rewardCc,
                inviteCode: claimedCode,
                distributed: true,
              },
              update: { inviteCode: claimedCode },
            });
          }
        } catch (err) {
          this.logger.warn(`submitQuest code-assign failed: ${String(err)}`);
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
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) {
      return {
        state: 'unknown' as const,
        inviteCode: null as string | null,
        message: 'Quest not found',
      };
    }

    const rewardType = normalizeRewardType(quest.rewardType);
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
          message:
            custom ||
            'Kamu pemenang! Cek email kamu untuk langkah selanjutnya.',
        };
      }
      const drawsHeld = await this.prisma.winnerDraw.count({
        where: { questId },
      });
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
        message: 'Pemenang akan diumumkan setelah event berakhir.',
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
      const drawsHeld = await this.prisma.winnerDraw.count({
        where: { questId },
      });
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
      const drawsHeld = await this.prisma.winnerDraw.count({
        where: { questId },
      });
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
          message:
            'The event has ended. Winners will be announced after the admin draw.',
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
          message:
            'All FCFS slots were claimed. Better luck on the next campaign.',
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
      const variant = draw?.rewardVariant as 'CODE' | 'CC' | null;
      if (draw?.distributed && draw.inviteCode) {
        const custom = quest.winnerMessage?.trim();
        return {
          state: 'cc_reward' as const,
          inviteCode: draw.inviteCode,
          rewardVariant: variant,
          message:
            custom ||
            `Congratulations! You received ${quest.rewardCc} CC and code: ${draw.inviteCode}`,
        };
      }
      if (draw?.distributed && !draw.inviteCode) {
        // Varian CC (kode null) atau reward pending.
        return {
          state: 'cc_reward' as const,
          inviteCode: null,
          rewardVariant: variant,
          message:
            variant === 'CC'
              ? `${quest.rewardCc} CC sent to your wallet.`
              : `${quest.rewardCc} CC sent to your wallet. Code will be assigned shortly.`,
        };
      }
      if (draw) {
        const fee = resolveClaimFeeCc(quest) ?? 5;
        const custom = quest.winnerMessage?.trim();
        // Pesan pre-claim menyesuaikan varian pemenang.
        if (variant === 'CODE') {
          return {
            state: 'fcfs_claimable' as const,
            inviteCode: null,
            rewardVariant: variant,
            message:
              custom ||
              `You won a Code! Pay ${fee} CC claim fee to reveal your invite code.`,
          };
        }
        if (variant === 'CC') {
          return {
            state: 'fcfs_claimable' as const,
            inviteCode: null,
            rewardVariant: variant,
            message:
              custom ||
              `You won ${quest.rewardCc} CC! Pay ${fee} CC claim fee to receive it.`,
          };
        }
        // Legacy both (variant null): butuh kode tersedia.
        const codesLeft = await this.countAvailableInviteCodes(questId);
        if (codesLeft <= 0) {
          return {
            state: 'fcfs_missed' as const,
            inviteCode: null,
            rewardVariant: variant,
            message: 'No codes left in the pool. Contact support.',
          };
        }
        return {
          state: 'fcfs_claimable' as const,
          inviteCode: null,
          rewardVariant: variant,
          message:
            custom ||
            `You won! Pay ${fee} CC claim fee to receive ${quest.rewardCc} CC + your invite code.`,
        };
      }
      const drawsHeld = await this.prisma.winnerDraw.count({
        where: { questId },
      });
      if (drawsHeld > 0) {
        return {
          state: 'not_winner' as const,
          inviteCode: null,
          rewardVariant: null,
          message: 'You were not selected in the raffle draw.',
        };
      }
      if (this.isCampaignEnded(quest)) {
        return {
          state: 'pending_draw' as const,
          inviteCode: null,
          rewardVariant: null,
          message:
            'The event has ended. Winners will be announced after the admin draw.',
        };
      }
      return {
        state: 'waitlist' as const,
        inviteCode: null,
        rewardVariant: null,
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
      throw new BadRequestException(
        'Create your Canton wallet before claiming.',
      );
    }

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) throw new NotFoundException('Quest not found');
    if (!this.requiresFcfsCcClaim(quest)) {
      throw new BadRequestException(
        'This campaign does not use FCFS CC claim.',
      );
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

    const validatorPartyId = this.config
      .get<string>('CANTON_VALIDATOR_PARTY_ID')
      ?.trim();
    if (!validatorPartyId) {
      throw new BadRequestException(
        'Validator party is not configured on the server.',
      );
    }

    let reserveResult: Awaited<
      ReturnType<QuestsService['reserveFcfsSlotLocked']>
    >;
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
            cantonPartyId,
            username,
            questTitle: quest.title,
            feeCc,
            feeLabel: 'FCFS claim fee (recovery)',
            feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
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
          await this.prisma.winnerDraw
            .delete({ where: { id: reservedDrawId } })
            .catch(() => {});
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
        await this.prisma.winnerDraw
          .delete({ where: { id: reservedDrawId } })
          .catch(() => {});
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

      // canquest-v6: DAML audit trail via QuestClaim (ClaimFcfsSlot on QuestCampaign).
      // campaignContractId diambil dari DB (disimpan saat admin buat quest).
      // Best-effort — tidak memblokir CC transfer jika ledger tidak tersedia.
      let claimSessionId: string | null = null;
      if (this.questLedger.isClaimSessionConfigured() && cantonPartyId) {
        const campaignContractId = (quest as any).ledgerCampaignId ?? null;
        if (campaignContractId) {
          const claimResult = await this.questLedger.claimFcfsSlot({
            campaignContractId,
            userPartyId: cantonPartyId,
            claimId: reservedDrawId,
          });
          claimSessionId = claimResult.claimContractId;
          if (claimResult.errors.length > 0) {
            this.logger.warn(
              `ClaimFcfsSlot warnings: ${claimResult.errors.join(' | ')}`,
            );
          } else {
            this.logger.log(
              `ClaimFcfsSlot OK: user=@${username} quest=${questId.slice(0, 8)} claim=${claimSessionId?.slice(0, 12)}`,
            );
          }
        } else {
          this.logger.warn(
            `ClaimFcfsSlot skipped: no ledgerCampaignId for quest=${questId}`,
          );
        }
      }

      // Step 1: user pays claim fee → validator node party (CANTON_VALIDATOR_PARTY_ID).
      // If the fee was already paid (previous attempt), skip collecting again.
      //
      // ⚠️ v11.1 fix: assertRewardPool DULU sebelum collectClaimFee.
      // Sebelumnya urutan terbalik — user bisa ke-charge fee tapi reward gagal
      // karena pool kosong. Sekarang: cek pool → collect fee → re-check pool
      // (race defense) → send reward.
      await this.assertRewardPool(rewardCc);

      const feeTxId =
        drawNow?.claimFeeLedgerTxId ??
        (await this.collectClaimFee({
          userId,
          cantonPartyId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'FCFS claim fee',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        }));

      // Persist fee TX early so retries don't double-charge and slot stays reserved.
      if (!drawNow?.claimFeeLedgerTxId) {
        await this.prisma.winnerDraw.updateMany({
          where: {
            id: reservedDrawId,
            questId,
            userId,
            distributed: false,
            claimFeeLedgerTxId: null,
          },
          data: { claimFeeLedgerTxId: feeTxId },
        });
      }

      // Step 2: reward wallet (canquest-reward) sends reward → same user party (only after fee is collected).
      // Re-check pool setelah fee terkumpul (defense against race condition:
      // pool bisa berkurang antara pre-check dan eksekusi sebenarnya).
      await this.assertRewardPool(rewardCc);
      const rewardPartyId = this.rewardPartyId;
      if (!rewardPartyId) {
        throw new Error('CANTON_REWARD_PARTY_ID not configured');
      }
      this.logger.log(
        `Claim fee step 2: ${rewardPartyId.split('::')[0]} → ${cantonPartyId.split('::')[0]} (@${username}, ${rewardCc} CC)`,
      );

      const rewardResult = await this.cantonLedger.sendReward({
        senderPartyId: rewardPartyId,
        receiverPartyId: cantonPartyId,
        amountCc: rewardCc,
        description: `FCFS reward — ${quest.title}`,
      });
      if (!rewardResult.ok) {
        throw new Error(rewardResult.error ?? 'reward transfer failed');
      }
      const rewardTxId =
        rewardResult.rewardTxId ?? `reward-${Date.now()}-${userId.slice(0, 8)}`;
      const rewardPending = rewardResult.pending;
      this.logger.log(
        `FCFS reward ${rewardCc} CC → ${cantonPartyId.split('::')[0]} ` +
          `(${rewardPending ? 'PENDING — user accepts in wallet' : 'direct'})`,
      );

      // ⚠️ SECURITY (C1): Persist distributed=true + ledgerTxId IMMEDIATELY after
      // sendReward succeeds, with a conditional updateMany. CC has now left the
      // reward wallet on-chain (irreversible). If recordTransaction / the
      // completion upsert below throws, the draw is already marked distributed
      // so a retry short-circuits at the top-of-function `draw.distributed`
      // check instead of sending the reward AGAIN (double payout).
      await this.prisma.winnerDraw.updateMany({
        where: { id: reservedDrawId, distributed: false },
        data: {
          distributed: true,
          ledgerTxId: rewardTxId,
          distributedAt: new Date(),
        },
      });

      // canquest-v21: Atomic DAML choice — fee + reward receipt dalam SATU transaksi.
      // Jika salah satu gagal, Canton rollback seluruhnya. Tidak ada partial commit.
      // (CC movement asli tetap via CIP-56; choice ini hanya menulis receipt.)
      if (claimSessionId) {
        const atomicResult = await this.questLedger.atomicFeeAndReward({
          claimContractId: claimSessionId,
          feeTxId,
          rewardTxId: rewardTxId,
        });
        if (!atomicResult.ok) {
          this.logger.warn(
            `DAML_AUDIT_TRAIL_FAIL AtomicFeeAndReward FCFS quest=${questId.slice(0, 8)} user=@${username} (non-blocking): ${atomicResult.errors.join(' | ')}`,
          );
        }
      }

      // ⚠️ SECURITY (C1): recordTransaction is NON-FATAL. CC already moved
      // on-chain and distributed is already persisted true above. A throw here
      // must NOT cause a re-send on the next request.
      try {
        await this.users.recordTransaction({
          userId,
          amountCc: rewardCc,
          type: 'QUEST_REWARD',
          description: `Received ${rewardCc} CC reward`,
          referenceId: questId,
          counterparty: rewardPartyId.split('::')[0],
          ledgerTxId: rewardTxId,
          status: rewardPending ? 'PENDING' : 'COMPLETED',
          transferInstructionCid: rewardResult.transferInstructionCid ?? null,
        });
      } catch (recordErr) {
        this.logger.error(
          `CLAIM_HISTORY_FAIL FCFS quest=${questId.slice(0, 8)} user=@${username}: reward sent (txId=${rewardTxId}) but history record threw: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
        );
      }

      // Asynchronous State Pattern — non-blocking balance sync
      if (username) {
        void this.inboundSync
          .alignBalanceFromChain(userId, username)
          .catch((err) =>
            this.logger.warn(
              `Balance sync failed (non-blocking): ${String(err)}`,
            ),
          );
      }

      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.winnerDraw.update({
          where: { id: reservedDrawId },
          data: {
            ccAmount: rewardCc,
            claimFeeLedgerTxId: feeTxId,
            // distributed + ledgerTxId already persisted above; keep them.
            ...(claimSessionId
              ? { claimSessionContractId: claimSessionId }
              : {}),
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
          payoutTxId: rewardTxId,
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
      throw new BadRequestException(
        'Create your Canton wallet before claiming.',
      );
    }

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) throw new NotFoundException('Quest not found');
    if (!this.requiresDrawCcClaim(quest)) {
      throw new BadRequestException(
        'This campaign does not use raffle CC claim.',
      );
    }

    const completion = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (!completion) {
      throw new BadRequestException(
        'Submit the quest before claiming your reward.',
      );
    }

    const draw = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (!draw) {
      throw new BadRequestException(
        'You were not selected in the raffle draw.',
      );
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
    const validatorPartyId = this.config
      .get<string>('CANTON_VALIDATOR_PARTY_ID')
      ?.trim();
    if (!validatorPartyId) {
      throw new BadRequestException(
        'Validator party is not configured on the server.',
      );
    }

    const balance = await this.splice.getUserBalance(username);
    if (balance !== null && balance < feeCc) {
      throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
    }

    this.logger.log(
      `Draw CC claim start quest=${questId} user=@${username} fee=${feeCc} reward=${rewardCc}`,
    );

    // Atomic lock: prevents two parallel requests for the same draw from both
    // passing the `distributed` check and double-paying the reward on-chain.
    const drawLocked = await this.acquireFcfsOnChainLock({
      drawId: draw.id,
      questId,
      userId,
    });
    if (!drawLocked) {
      throw new BadRequestException(
        'Claim already in progress. Wait a moment before trying again.',
      );
    }

    try {
      // Re-check distributed under the lock to close the TOCTOU window between
      // the earlier `draw.distributed` check and acquiring the on-chain lock.
      const drawNow = await this.prisma.winnerDraw.findUnique({
        where: { id: draw.id },
      });
      if (drawNow?.distributed) {
        const rewardStatus = await this.getQuestRewardStatus(userId, questId);
        return {
          ok: true,
          message: 'You already claimed this reward.',
          rewardCc: quest.rewardCc,
          feeCc: 0,
          rewardStatus,
        };
      }

      // canquest-v11.1 fix: Sebelumnya flow raffle memanggil 4 stub deprecated
      // (createClaimSession / createEarnClaimSession / createRaffleWinner /
      // createCcRewardEntitlement) yang SEMUA selalu return null — akibatnya
      // claimSessionId selalu null dan branch AtomicFeeAndReward di bawah
      // TIDAK PERNAH jalan untuk raffle (audit trail raffle kosong).
      //
      // Fix: gunakan pattern yang sama dengan FCFS — exercise DrawRaffleWinner
      // pada QuestCampaign yang sudah dibuat admin (ledgerCampaignId di DB).
      // Ini menghasilkan (campaignCid, claimCid) yang langsung jadi
      // claimSessionId untuk atomicFeeAndReward.
      let claimSessionId: string | null = null;
      if (this.questLedger.isClaimSessionConfigured() && cantonPartyId) {
        const campaignContractId = (quest as any).ledgerCampaignId ?? null;
        if (campaignContractId) {
          const claimResult = await this.questLedger.drawRaffleWinner({
            campaignContractId,
            userPartyId: cantonPartyId,
            claimId: draw.id,
          });
          claimSessionId = claimResult.claimContractId;
          if (claimResult.errors.length > 0) {
            this.logger.warn(
              `DrawRaffleWinner warnings: ${claimResult.errors.join(' | ')}`,
            );
          } else {
            this.logger.log(
              `DrawRaffleWinner OK: user=@${username} quest=${questId.slice(0, 8)} claim=${claimSessionId?.slice(0, 12)}`,
            );
          }
        } else {
          this.logger.warn(
            `DrawRaffleWinner skipped: no ledgerCampaignId for quest=${questId}`,
          );
        }
      }

      // v11.1: assertRewardPool DULU sebelum collectClaimFee (sama seperti FCFS).
      // Mencegah user kena fee charge tapi reward gagal karena pool kosong.
      await this.assertRewardPool(rewardCc);

      // ⚠️ SECURITY (C1): Fee idempotency guard. If a previous attempt already
      // collected the fee (claimFeeLedgerTxId persisted) but failed before the
      // reward was sent, re-using that txId here avoids charging the user twice
      // on retry. Mirrors claimFcfsReward (line ~2075) and claimInviteReward.
      const feeTxId =
        drawNow?.claimFeeLedgerTxId ??
        (await this.collectClaimFee({
          userId,
          cantonPartyId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'Raffle claim fee',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        }));

      // Persist fee txId early so a retry after this point doesn't double-charge.
      if (!drawNow?.claimFeeLedgerTxId) {
        await this.prisma.winnerDraw.updateMany({
          where: {
            id: draw.id,
            questId,
            userId,
            distributed: false,
            claimFeeLedgerTxId: null,
          },
          data: { claimFeeLedgerTxId: feeTxId },
        });
      }

      // Re-check pool setelah fee terkumpul (race defense).
      await this.assertRewardPool(rewardCc);

      // ⚠️ SECURITY (C1): Re-check distributed under the lock RIGHT BEFORE
      // sendReward. If a previous attempt sent the reward on-chain but failed
      // to commit distributed=true (DB error), the row would still show
      // distributed=false and this attempt would re-send → double payout. We
      // also record the reward txId the moment the transfer succeeds so a
      // crash leaves an auditable trail. See C1 writeup.
      const drawPreSend = await this.prisma.winnerDraw.findUnique({
        where: { id: draw.id },
        select: { distributed: true, ledgerTxId: true },
      });
      if (drawPreSend?.distributed) {
        const rewardStatus = await this.getQuestRewardStatus(userId, questId);
        return {
          ok: true,
          message: 'You already claimed this reward.',
          rewardCc: quest.rewardCc,
          feeCc: 0,
          rewardStatus,
        };
      }

      const rewardResult = await this.cantonLedger.sendReward({
        receiverPartyId: cantonPartyId,
        amountCc: rewardCc,
        description: `Raffle reward — ${quest.title}`,
      });
      if (!rewardResult.ok) {
        throw new Error(rewardResult.error ?? 'reward transfer failed');
      }
      // pertahankan nama var lama supaya downstream (atomic/record) tetap jalan
      const rewardOfferId = rewardResult.rewardTxId ?? `reward-${Date.now()}`;
      const rewardPending = rewardResult.pending;
      this.logger.log(
        `Draw reward ${rewardCc} CC → ${cantonPartyId.split('::')[0]} ` +
          `(${rewardPending ? 'PENDING — user accepts in wallet' : 'direct'})`,
      );

      // ⚠️ SECURITY (C1): Persist distributed=true + ledgerTxId IMMEDIATELY after
      // sendReward succeeds, with a conditional updateMany. CC has now left the
      // reward wallet on-chain (irreversible). If anything after this throws,
      // the draw is already marked distributed=true so a retry short-circuits
      // instead of sending the reward again. We do NOT wait for recordTransaction
      // (history) here — that is moved after this guard and is non-fatal.
      await this.prisma.winnerDraw.updateMany({
        where: { id: draw.id, distributed: false },
        data: {
          distributed: true,
          ledgerTxId: rewardOfferId,
          distributedAt: new Date(),
        },
      });

      // canquest-v11.1: Atomic DAML choice — fee + reward + audit trail dalam SATU transaksi.
      // v11.1 fix: hapus branch earnClaimSessionId legacy (deprecated stub selalu null).
      // Sekarang claimSessionId dari drawRaffleWinner di atas — selalu ada jika
      // ledger aktif & ledgerCampaignId tersedia.
      if (claimSessionId) {
        const atomicResult = await this.questLedger.atomicFeeAndReward({
          claimContractId: claimSessionId,
          feeTxId,
          rewardTxId: rewardOfferId,
        });
        if (!atomicResult.ok) {
          this.logger.warn(
            `DAML_AUDIT_TRAIL_FAIL AtomicFeeAndReward DrawCC quest=${questId.slice(0, 8)} user=@${username} (non-blocking): ${atomicResult.errors.join(' | ')}`,
          );
        }
      }

      // ⚠️ SECURITY (C1): recordTransaction is now NON-FATAL. CC already moved
      // on-chain and distributed is already persisted true above. If this throws
      // we must NOT re-send the reward on the next request — and we won't,
      // because distributed=true is already committed.
      try {
        await this.users.recordTransaction({
          userId,
          amountCc: rewardCc,
          type: 'QUEST_REWARD',
          description: `Received ${rewardCc} CC raffle reward`,
          referenceId: questId,
          counterparty: validatorPartyId.split('::')[0],
          ledgerTxId: rewardOfferId,
          status: rewardPending ? 'PENDING' : 'COMPLETED',
          transferInstructionCid: rewardResult.transferInstructionCid ?? null,
        });
      } catch (recordErr) {
        this.logger.error(
          `CLAIM_HISTORY_FAIL DrawCC quest=${questId.slice(0, 8)} user=@${username}: reward sent (txId=${rewardOfferId}) but history record threw: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
        );
      }

      // Asynchronous State Pattern: balance sync tidak memblokir response HTTP.
      // UI Next.js langsung menerima response, balance di-refresh di belakang.
      if (username) {
        void this.inboundSync
          .alignBalanceFromChain(userId, username)
          .catch((err) =>
            this.logger.warn(
              `Balance sync failed (non-blocking): ${String(err)}`,
            ),
          );
      }

      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.winnerDraw.update({
          where: { id: draw.id },
          data: {
            ccAmount: rewardCc,
            claimFeeLedgerTxId: feeTxId,
            // distributed + ledgerTxId already persisted above; keep them.
            ...(claimSessionId
              ? { claimSessionContractId: claimSessionId }
              : {}),
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
    } finally {
      this.releaseFcfsOnChainLock(questId, userId, draw.id);
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
      throw new BadRequestException(
        'Create your Canton wallet before claiming.',
      );
    }

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    const rewardType = normalizeRewardType(quest.rewardType);
    const paidInvite =
      requiresPaidInviteClaim(quest) &&
      (rewardType === RewardType.INVITE_CODE_FCFS ||
        rewardType === RewardType.INVITE_CODE_RANDOM ||
        rewardType === RewardType.INVITE_CODE);
    if (!paidInvite) {
      throw new BadRequestException(
        'This campaign does not use paid code claim.',
      );
    }

    const completion = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (!completion) {
      throw new BadRequestException(
        'Submit the quest before claiming your code.',
      );
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
        throw new BadRequestException(
          'You were not selected in the raffle draw.',
        );
      }
      if (this.isCampaignEnded(quest) === false) {
        const drawsHeld = await this.prisma.winnerDraw.count({
          where: { questId },
        });
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

    const validatorPartyId = this.config
      .get<string>('CANTON_VALIDATOR_PARTY_ID')
      ?.trim();
    if (!validatorPartyId) {
      throw new BadRequestException(
        'Validator party is not configured on the server.',
      );
    }

    let feeTxId: string;
    if (existingDraw?.claimFeeLedgerTxId) {
      feeTxId = existingDraw.claimFeeLedgerTxId;
    } else {
      try {
        feeTxId = await this.collectClaimFee({
          userId,
          cantonPartyId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'Claim fee',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
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

    // Determine claim kind for Code rewards (CODE_FCFS or CODE_RAFFLE).
    //
    // v11.1 fix: Sebelumnya blok ini memanggil 4 stub deprecated
    // (createEarnClaimSession / markEarnClaimFeePaid / createRaffleWinner /
    // createFcfsSlotReservation) yang SEMUA selalu return null → tidak ada
    // audit trail DAML sama sekali untuk Code rewards.
    //
    // Fix: exercise QuestCampaign on-chain (ClaimFcfsSlot atau DrawRaffleWinner),
    // yang menghasilkan (campaignCid, claimCid). claimCid disimpan untuk
    // revealRewardCode SETELAH kode benar-benar di-assign dari pool.
    // Kuota FCFS & status campaign divalidasi on-chain di DAML choice.
    const codeClaimKind: 'CODE_FCFS' | 'CODE_RAFFLE' =
      rewardType === RewardType.INVITE_CODE_FCFS ? 'CODE_FCFS' : 'CODE_RAFFLE';

    let codeClaimSessionId: string | null = null;
    if (this.questLedger.isClaimSessionConfigured() && cantonPartyId) {
      const campaignContractId = (quest as any).ledgerCampaignId ?? null;
      if (campaignContractId) {
        const claimId = `code-${existingDraw?.id ?? userId.slice(0, 12)}-${Date.now().toString(36)}`;
        try {
          const claimResult =
            codeClaimKind === 'CODE_FCFS'
              ? await this.questLedger.claimFcfsSlot({
                  campaignContractId,
                  userPartyId: cantonPartyId,
                  claimId,
                })
              : await this.questLedger.drawRaffleWinner({
                  campaignContractId,
                  userPartyId: cantonPartyId,
                  claimId,
                });
          codeClaimSessionId = claimResult.claimContractId;
          if (claimResult.errors.length > 0) {
            this.logger.warn(
              `QuestCampaign ${codeClaimKind} warnings: ${claimResult.errors.join(' | ')}`,
            );
          } else {
            this.logger.log(
              `QuestCampaign ${codeClaimKind} OK: user=@${username} quest=${questId.slice(0, 8)} claim=${codeClaimSessionId?.slice(0, 12)}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `QuestCampaign ${codeClaimKind} failed (non-blocking): ${String(err)}`,
          );
        }
      } else {
        this.logger.warn(
          `QuestCampaign ${codeClaimKind} skipped: no ledgerCampaignId for quest=${questId}`,
        );
      }
    }

    try {
      // Atomically reserve one code (FOR UPDATE SKIP LOCKED). The previous
      // findFirst+update pattern had a TOCTOU race: two parallel claims read
      // the same free row, then the second upsert silently overwrote the first
      // assignment — a code leaked and was mis-attributed.
      const claimedCode = await this.reserveInviteCode(questId, userId);
      if (!claimedCode) {
        throw new BadRequestException('No invite codes available.');
      }

      await this.prisma.$transaction([
        this.prisma.winnerDraw.upsert({
          where: { questId_userId: { questId, userId } },
          create: {
            questId,
            userId,
            ccAmount: quest.rewardCc,
            inviteCode: claimedCode,
            distributed: true,
            claimFeeLedgerTxId: feeTxId,
          },
          update: {
            inviteCode: claimedCode,
            distributed: true,
            claimFeeLedgerTxId: feeTxId,
          },
        }),
      ]);

      // Re-read the row so downstream ledger sync has the assigned id/code.
      const codeRow = await this.prisma.inviteCodePool.findFirst({
        where: { questId, userId, code: claimedCode },
      });

      // v11.1: Reveal reward code on-chain via RevealRewardCode choice.
      // Sebelumnya: createCodeRewardEntitlement (stub deprecated, selalu null).
      // Sekarang: pakai codeClaimSessionId dari ClaimFcfsSlot/DrawRaffleWinner di atas,
      // lalu reveal kode yang baru di-assign. DAML akan archive claim lama &
      // buat baru dengan rewardCode ter-set — audit trail on-chain akurat.
      if (codeClaimSessionId) {
        const revealRes = await this.questLedger.revealRewardCode({
          claimContractId: codeClaimSessionId,
          code: claimedCode,
        });
        if (!revealRes.ok) {
          this.logger.warn(
            `DAML_AUDIT_TRAIL_FAIL RevealRewardCode ${codeClaimKind} quest=${questId.slice(0, 8)} user=@${username} (non-blocking): ${revealRes.errors.join(' | ')}`,
          );
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
      inviteCode:
        (
          await this.prisma.winnerDraw.findUnique({
            where: { questId_userId: { questId, userId } },
          })
        )?.inviteCode ?? null,
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
    rewardVariant: 'CODE' | 'CC' | null;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
  }> {
    const { userId, questId, username, cantonPartyId } = params;
    if (!username?.trim() || !cantonPartyId?.trim()) {
      throw new BadRequestException(
        'Create your Canton wallet before claiming.',
      );
    }
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) throw new NotFoundException('Quest not found');
    if (!this.requiresCcAndCodeRaffleClaim(quest)) {
      throw new BadRequestException(
        'This campaign does not use CC + Code combined raffle claim.',
      );
    }
    const completion = await this.prisma.questCompletion.findUnique({
      where: { userId_questId: { userId, questId } },
    });
    if (!completion) {
      throw new BadRequestException(
        'Submit the quest before claiming your reward.',
      );
    }
    const draw = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    if (!draw) {
      throw new BadRequestException(
        'You were not selected in the raffle draw.',
      );
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
        rewardVariant: draw.rewardVariant as 'CODE' | 'CC' | null,
        rewardStatus,
      };
    }
    // Varian reward pemenang (CC_AND_CODE_RAFFLE split): 'CODE', 'CC', atau null (legacy both).
    const variant = draw.rewardVariant as 'CODE' | 'CC' | null;

    // Cek kode tersedia hanya bila pemenang ini akan menerima kode (varian CODE
    // atau legacy both). Varian CC tidak butuh kode.
    if (variant !== 'CC') {
      const codesLeft = await this.countAvailableInviteCodes(questId);
      if (codesLeft <= 0) {
        throw new BadRequestException(
          'No invite codes left in the pool. Contact support.',
        );
      }
    }
    const feeCc = resolveClaimFeeCc(quest) ?? 5;
    const rewardCc = variant === 'CODE' ? 0 : quest.rewardCc;
    const validatorPartyId = this.config
      .get<string>('CANTON_VALIDATOR_PARTY_ID')
      ?.trim();
    if (!validatorPartyId) {
      throw new BadRequestException(
        'Validator party is not configured on the server.',
      );
    }
    const balance = await this.splice.getUserBalance(username);
    if (balance !== null && balance < feeCc) {
      throw new BadRequestException(FCFS_CLAIM_FAIL_MSG);
    }
    this.logger.log(
      `CC+Code raffle claim start quest=${questId} user=@${username} fee=${feeCc} reward=${rewardCc} CC + code`,
    );

    // Atomic lock: prevents two parallel requests for the same draw from both
    // passing the `distributed` check and double-paying the reward on-chain.
    const raffleLocked = await this.acquireFcfsOnChainLock({
      drawId: draw.id,
      questId,
      userId,
    });
    if (!raffleLocked) {
      throw new BadRequestException(
        'Claim already in progress. Wait a moment before trying again.',
      );
    }

    try {
      // Re-check distributed under the lock (TOCTOU hardening).
      const drawNow = await this.prisma.winnerDraw.findUnique({
        where: { id: draw.id },
      });
      if (drawNow?.distributed) {
        const rewardStatus = await this.getQuestRewardStatus(userId, questId);
        return {
          ok: true,
          message: drawNow.inviteCode
            ? `Already claimed: ${quest.rewardCc} CC + code ${drawNow.inviteCode}`
            : 'You already claimed this reward.',
          rewardCc: quest.rewardCc,
          inviteCode: drawNow.inviteCode,
          feeCc: 0,
          rewardVariant: drawNow.rewardVariant as 'CODE' | 'CC' | null,
          rewardStatus,
        };
      }

      // v11.1: assertRewardPool DULU sebelum collectClaimFee (konsisten dengan FCFS/raffle).
      // Mencegah user kena fee charge tapi reward gagal karena pool kosong.
      // (Varian CODE tidak mengirim CC → rewardCc=0 → lewati assert pool.)
      if (rewardCc > 0) {
        await this.assertRewardPool(rewardCc);
      }

      // v11.1: exercise DrawRaffleWinner di QuestCampaign on-chain untuk dapat
      // claimSessionId (sebelumnya flow CC+Code raffle tidak punya DAML audit).

      const ccCodeCampaignCid = (quest as any).ledgerCampaignId ?? null;
      let ccCodeClaimSessionId: string | null = null;
      if (
        this.questLedger.isClaimSessionConfigured() &&
        cantonPartyId &&
        ccCodeCampaignCid
      ) {
        try {
          const claimResult = await this.questLedger.drawRaffleWinner({
            campaignContractId: ccCodeCampaignCid,
            userPartyId: cantonPartyId,
            claimId: draw.id,
          });
          ccCodeClaimSessionId = claimResult.claimContractId;
          if (claimResult.errors.length > 0) {
            this.logger.warn(
              `DrawRaffleWinner (CC+Code) warnings: ${claimResult.errors.join(' | ')}`,
            );
          } else {
            this.logger.log(
              `DrawRaffleWinner (CC+Code) OK: user=@${username} quest=${questId.slice(0, 8)} claim=${ccCodeClaimSessionId?.slice(0, 12)}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `DrawRaffleWinner (CC+Code) failed (non-blocking): ${String(err)}`,
          );
        }
      }

      // ⚠️ SECURITY (C1): Fee idempotency guard — re-use an existing fee txId if a
      // previous attempt already charged the fee, so a retry doesn't double-charge.
      const feeTxId =
        drawNow?.claimFeeLedgerTxId ??
        (await this.collectClaimFee({
          userId,
          cantonPartyId,
          username,
          questTitle: quest.title,
          feeCc,
          feeLabel: 'CC+Code raffle claim fee',
          feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
        }));

      // Persist fee txId early so a retry after this point doesn't double-charge.
      if (!drawNow?.claimFeeLedgerTxId) {
        await this.prisma.winnerDraw.updateMany({
          where: {
            id: draw.id,
            questId,
            userId,
            distributed: false,
            claimFeeLedgerTxId: null,
          },
          data: { claimFeeLedgerTxId: feeTxId },
        });
      }

      // Re-check pool setelah fee (race defense).
      await this.assertRewardPool(rewardCc);
      let rewardOfferId: string | null = null;
      if (rewardCc > 0) {
        // ⚠️ SECURITY (C1): Re-check distributed right before sendReward.
        const drawPreSend = await this.prisma.winnerDraw.findUnique({
          where: { id: draw.id },
          select: { distributed: true, ledgerTxId: true },
        });
        if (drawPreSend?.distributed) {
          const rewardStatus = await this.getQuestRewardStatus(userId, questId);
          return {
            ok: true,
            message: 'You already claimed this reward.',
            rewardCc: quest.rewardCc,
            inviteCode: drawPreSend.ledgerTxId ? null : null,
            feeCc: 0,
            rewardVariant: variant,
            rewardStatus,
          };
        }

        const rewardResult = await this.cantonLedger.sendReward({
          receiverPartyId: cantonPartyId,
          amountCc: rewardCc,
          description: `CC+Code raffle reward — ${quest.title}`,
        });
        if (!rewardResult.ok)
          throw new Error(rewardResult.error ?? 'CC reward transfer failed');
        rewardOfferId = rewardResult.rewardTxId ?? `reward-${Date.now()}`;
        this.logger.log(
          `Raffle reward ${rewardCc} CC → ${cantonPartyId.split('::')[0]} ` +
            `(${rewardResult.pending ? 'PENDING — user accepts in wallet' : 'direct'})`,
        );

        // ⚠️ SECURITY (C1): Persist distributed=true + ledgerTxId IMMEDIATELY after
        // sendReward succeeds. CC has now left the reward wallet on-chain
        // (irreversible). If reserveInviteCode or the completion upsert below
        // throws, the draw is already marked distributed so a retry short-circuits
        // instead of sending the reward AGAIN (double payout). This is the exact
        // fix for the C1 scenario where code exhaustion caused a re-send.
        await this.prisma.winnerDraw.updateMany({
          where: { id: draw.id, distributed: false },
          data: {
            distributed: true,
            ledgerTxId: rewardOfferId,
            distributedAt: new Date(),
          },
        });

        // recordTransaction is NON-FATAL — CC already moved on-chain + distributed persisted.
        try {
          await this.users.recordTransaction({
            userId,
            amountCc: rewardCc,
            type: 'QUEST_REWARD',
            description: `Received ${rewardCc} CC raffle reward`,
            referenceId: questId,
            counterparty: validatorPartyId.split('::')[0],
            ledgerTxId: rewardOfferId,
            status: rewardResult.pending ? 'PENDING' : 'COMPLETED',
            transferInstructionCid: rewardResult.transferInstructionCid ?? null,
          });
        } catch (recordErr) {
          this.logger.error(
            `CLAIM_HISTORY_FAIL CC+Code quest=${questId.slice(0, 8)} user=@${username}: reward sent (txId=${rewardOfferId}) but history record threw: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
          );
        }
        // Asynchronous State Pattern — non-blocking balance sync
        if (username) {
          void this.inboundSync
            .alignBalanceFromChain(userId, username)
            .catch((err) =>
              this.logger.warn(
                `Balance sync failed (non-blocking): ${String(err)}`,
              ),
            );
        }
      }
      // Atomically reserve one code (FOR UPDATE SKIP LOCKED). The per-user
      // raffle lock above does NOT stop two DIFFERENT users from grabbing the
      // same code row — findFirst+update had that TOCTOU race. The transaction
      // below merges the code assignment with the winnerDraw/questCompletion
      // update so a code is never marked distributed without being claimed.
      //
      // Varian CC tidak menerima kode → lewati reserveInviteCode.
      let claimedCode: string | null = null;
      if (variant !== 'CC') {
        claimedCode = await this.reserveInviteCode(questId, userId);
        if (!claimedCode) {
          throw new Error(
            'No invite codes available after fee was paid. Contact support.',
          );
        }
      }
      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.$transaction([
        this.prisma.winnerDraw.update({
          where: { id: draw.id },
          data: {
            distributed: true,
            ccAmount: rewardCc,
            inviteCode: claimedCode,
            claimFeeLedgerTxId: feeTxId,
            ledgerTxId: rewardOfferId ?? undefined,
            distributedAt: new Date(),
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
      const finalCode = claimedCode;
      if (cantonPartyId && rewardOfferId) {
        void this.syncCampaignLedgerAfterPayout({
          userId,
          questId,
          userPartyId: cantonPartyId,
          rewardCc,
          payoutTxId: rewardOfferId,
        }).catch((err) =>
          this.logger.warn(`CC+Code raffle ledger sync failed: ${String(err)}`),
        );
      }

      // v11.1: Atomic DAML audit trail (fee + reward) + reveal code on-chain.
      // Sebelumnya flow CC+Code raffle tidak punya DAML audit sama sekali.
      if (ccCodeClaimSessionId && rewardOfferId) {
        const atomicResult = await this.questLedger.atomicFeeAndReward({
          claimContractId: ccCodeClaimSessionId,
          feeTxId,
          rewardTxId: rewardOfferId,
        });
        if (!atomicResult.ok) {
          this.logger.warn(
            `DAML_AUDIT_TRAIL_FAIL AtomicFeeAndReward CC+Code quest=${questId.slice(0, 8)} user=@${username} (non-blocking): ${atomicResult.errors.join(' | ')}`,
          );
        }
        // Reveal kode yang baru di-assign dari pool (hanya bila ada kode).
        if (finalCode) {
          const revealRes = await this.questLedger.revealRewardCode({
            claimContractId: atomicResult.claimFinalCid ?? ccCodeClaimSessionId,
            code: finalCode,
          });
          if (!revealRes.ok) {
            this.logger.warn(
              `DAML_AUDIT_TRAIL_FAIL RevealRewardCode CC+Code quest=${questId.slice(0, 8)} user=@${username} code=${finalCode.slice(0, 6)}… (non-blocking): ${revealRes.errors.join(' | ')}`,
            );
          }
        }
      }

      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      // Pesan akhir menyesuaikan varian: CODE (hanya kode), CC (hanya token), both (legacy).
      const message =
        variant === 'CODE'
          ? `Congratulations! Your invite code is: ${finalCode}`
          : variant === 'CC'
            ? `Congratulations! ${rewardCc} CC sent to your wallet.`
            : `Congratulations! ${rewardCc} CC sent to your wallet and your code is: ${finalCode}`;
      return {
        ok: true,
        message,
        rewardCc,
        inviteCode: finalCode,
        feeCc,
        rewardVariant: variant,
        rewardStatus,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`CC+Code raffle claim failed: ${detail}`);
      throw new BadRequestException(this.fcfsClaimErrorMessage(detail));
    } finally {
      this.releaseFcfsOnChainLock(questId, userId, draw.id);
    }
  }

  private get feeTargetLabel(): string {
    return this.feeTargetPartyId?.split('::')[0] ?? 'fee';
  }

  private async collectClaimFee(params: {
    userId: string;
    cantonPartyId: string;
    username: string;
    questTitle: string;
    feeCc: number;
    feeLabel: string;
    feeTargetPartyId: string;
  }): Promise<string> {
    const feeResult = await this.splice.collectClaimFeeToValidatorParty({
      senderPartyId: params.cantonPartyId,
      senderUsername: params.username,
      feeCc: params.feeCc,
      description: `${params.feeLabel} — ${params.questTitle}`,
      validatorPartyId: params.feeTargetPartyId,
    });

    if (!feeResult.collected) {
      throw new Error(feeResult.error ?? 'fee collect failed');
    }

    // Gunakan ledgerTxId dari Splice jika ada; fallback ke UUID agar DAML
    // AtomicFeeAndReward tidak gagal assertion "feeTxId tidak boleh kosong".
    const ledgerTxId =
      feeResult.ledgerTxId?.trim() ||
      `fee-${Date.now()}-${params.userId.slice(0, 8)}`;
    const feeLabel = params.feeTargetPartyId.split('::')[0];
    await this.users.recordTransaction({
      userId: params.userId,
      amountCc: params.feeCc,
      type: 'TRANSFER_OUT',
      description: `Sent ${params.feeCc} CC claim fee`,
      // Penanda "fee:" → filter visibility (CC_TRANSACTION_HISTORY_WHERE) sembunyikan
      // baris ini dari history & notifikasi. Party fee tetap tercatat untuk audit.
      referenceId: `fee:${feeLabel}`,
      ledgerTxId,
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
   * task earn + quest/campaign bonus + referral.
   */
  async getLeaderboard(
    period: 'weekly' | 'monthly' | 'all',
    page = 1,
    pageSize = 10,
  ): Promise<{
    rows: LeaderboardRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    // "All time" = saldo points mutakhir (lifetime total - spent), sinkron dengan
    // Dashboard / /users/me/points. Weekly/Monthly tetap kompetisi aktivitas periode.
    const aggregated =
      period === 'all'
        ? await this.points.buildRemainingPointsByUser()
        : await this.points.buildNetPointsByUser(this.leaderboardSince(period));
    const sorted = aggregated; // sudah sorted desc
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

  private leaderboardSince(
    period: 'weekly' | 'monthly' | 'all',
  ): Date | undefined {
    if (period === 'all') return undefined;
    const now = Date.now();
    const ms =
      period === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    return new Date(now - ms);
  }

  /* ─── User dashboard stats ─── */

  async getUserDashboardStats(userId: string): Promise<UserDashboardStats> {
    const totalPoints = await this.users.reconcileEarnPoints(userId);

    const [
      completions,
      txCount,
      spentResult,
      pointsRemaining,
      earnHubCompleted,
      campaignCompleted,
    ] = await Promise.all([
      this.prisma.questCompletion.count({ where: { userId } }),
      this.prisma.ccTransaction.count({ where: { userId } }),
      this.prisma.earnEntry.aggregate({
        where: { userId },
        _sum: { pointsSpent: true },
      }),
      this.users.getNetPoints(userId),
      this.prisma.questCompletion.count({
        where: { userId, quest: { questKind: 'EARN_HUB' } },
      }),
      this.prisma.questCompletion.count({
        where: { userId, quest: { questKind: 'CAMPAIGN' } },
      }),
    ]);

    const weeklyBoard = await this.getLeaderboard('weekly', 1, 10_000);
    const idx = weeklyBoard.rows.findIndex((r) => r.userId === userId);
    const weeklyRank = idx >= 0 ? idx + 1 : weeklyBoard.total + 1;

    return {
      totalPoints,
      questsCompleted: completions,
      txCount,
      weeklyRank,
      pointsSpent: spentResult._sum.pointsSpent ?? 0,
      pointsRemaining,
      earnHubCompleted,
      campaignCompleted,
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
    const [submissions, txs, completions, referrals] = await Promise.all([
      this.prisma.questSubmission.findMany({
        where: { userId, status: 'VERIFIED' },
        orderBy: { verifiedAt: 'desc' },
        take: fetchCap,
        include: {
          task: { select: { title: true, points: true } },
          quest: { select: { title: true } },
        },
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

  /** Required number of sends for a send-transaction task (stored in task.target). Min 1. */
  private parseSendTransactionRequired(
    target: string | null | undefined,
  ): number {
    const n = parseInt((target ?? '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /** True when the user has a real Canton wallet (not a local placeholder). */
  private hasRealWallet(cantonPartyId: string | null | undefined): boolean {
    const id = cantonPartyId?.trim();
    return Boolean(id && !id.startsWith('canquest:'));
  }

  /**
   * Count a user's REAL outgoing CC sends since `since`. Only a genuine,
   * completed peer-to-peer CC send counts:
   *   - type = TRANSFER_OUT
   *   - status = COMPLETED  (offer-only sends are PENDING — CC has not actually
   *     moved until the recipient accepts, so they must NOT count)
   *   - counterparty is NOT a platform fee party
   *
   * Fee rows are excluded three ways (mirrors CC_TRANSACTION_HISTORY_WHERE +
   * isFeePartyRecipient so every fee path is covered):
   *   1. referenceId prefix "fee:"        — explicit marker written at fee creation
   *   2. description prefix "Platform fee" / contains " CC claim fee"
   *   3. counterparty short label == a fee party label (e.g. "canquest-fee"),
   *      with or without the "::" suffix — catches unmarked legacy/alternate rows.
   *
   * One real send = 1 count.
   */
  private async countRecentUserSends(
    userId: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.prisma.ccTransaction.findMany({
      where: {
        userId,
        type: 'TRANSFER_OUT',
        status: 'COMPLETED',
        createdAt: { gte: since },
      },
      select: { referenceId: true, description: true },
    });
    let count = 0;
    for (const tx of rows) {
      if (isFeeTransactionRow(tx.referenceId, tx.description)) continue;
      count++;
    }
    return count;
  }

  /**
   * Verify a send-transaction task: wallet required + the user made at least
   * `requiredCount` real CC sends in the last 24 hours. Returns ok=false with an
   * English message when not met (no points, no submission row created).
   */
  private async verifySendTransactionTask(params: {
    userId: string;
    userPartyId: string;
    requiredCount: number;
  }): Promise<{ ok: boolean; message?: string }> {
    if (!this.hasRealWallet(params.userPartyId)) {
      return {
        ok: false,
        message: 'Create your Canton wallet first to complete this task.',
      };
    }
    const windowStart = startOfTodayUtc();
    const today = await this.countRecentUserSends(params.userId, windowStart);
    if (today < params.requiredCount) {
      return {
        ok: false,
        message: `You have sent ${today}/${params.requiredCount} transaction(s) today. Send more CC to complete this task.`,
      };
    }
    return { ok: true };
  }

  /**
   * Lock-CC tier thresholds (seconds). A lock qualifies for tier T when its
   * lockSeconds >= the tier's threshold. Cascade: completing a higher tier
   * auto-completes every lower tier in the same quest.
   */
  private static readonly LOCK_CC_TIER_SECONDS: Record<string, number> = {
    '3d': 3 * 24 * 60 * 60, // 259200
    '7d': 7 * 24 * 60 * 60, // 604800
    '15d': 15 * 24 * 60 * 60, // 1296000
  };

  /** Resolve a lock-cc task target (termKey "3d"/"7d"/"15d") to its second threshold. */
  private lockCcTierSeconds(target: string | null | undefined): number {
    const key = (target ?? '').trim().toLowerCase();
    return QuestsService.LOCK_CC_TIER_SECONDS[key] ?? 3 * 24 * 60 * 60;
  }

  /**
   * Count a user's REAL outgoing non-CC token sends (default USDCx) since `since`.
   *   - type = TOKEN_TRANSFER_OUT
   *   - status = COMPLETED (offer-only sends are PENDING until recipient accepts)
   *
   * One real send = 1 count. Swap never uses TokenTransaction, so it cannot leak.
   */
  private async countRecentUserTokenSends(
    userId: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.tokenTransaction.count({
      where: {
        userId,
        type: 'TOKEN_TRANSFER_OUT',
        status: 'COMPLETED',
        createdAt: { gte: since },
      },
    });
  }

  /**
   * Verify a send-token task: wallet required + the user made at least
   * `requiredCount` real USDCx sends in the last 24 hours. Returns ok=false with
   * an English message when not met (no points, no submission row created).
   */
  private async verifySendTokenTask(params: {
    userId: string;
    userPartyId: string;
    requiredCount: number;
  }): Promise<{ ok: boolean; message?: string }> {
    if (!this.hasRealWallet(params.userPartyId)) {
      return {
        ok: false,
        message: 'Create your Canton wallet first to complete this task.',
      };
    }
    const windowStart = startOfTodayUtc();
    const today = await this.countRecentUserTokenSends(params.userId, windowStart);
    if (today < params.requiredCount) {
      return {
        ok: false,
        message: `You have sent ${today}/${params.requiredCount} USDCx transaction(s) today. Send more USDCx to complete this task.`,
      };
    }
    return { ok: true };
  }

  /**
   * Count a user's REAL swaps since `since`. Counts either direction
   * (CC→USDCx = SWAP_OUT, USDCx→CC = SWAP_IN), COMPLETED only.
   */
  private async countRecentUserSwaps(
    userId: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.ccTransaction.count({
      where: {
        userId,
        type: { in: ['SWAP_OUT', 'SWAP_IN'] },
        status: 'COMPLETED',
        createdAt: { gte: since },
      },
    });
  }

  /**
   * Verify a daily-swap task: wallet required + the user made at least
   * `requiredCount` real swaps in the last 24 hours. Returns ok=false with an
   * English message when not met (no points, no submission row created).
   */
  private async verifyDailySwapTask(params: {
    userId: string;
    userPartyId: string;
    requiredCount: number;
  }): Promise<{ ok: boolean; message?: string }> {
    if (!this.hasRealWallet(params.userPartyId)) {
      return {
        ok: false,
        message: 'Create your Canton wallet first to complete this task.',
      };
    }
    const windowStart = startOfTodayUtc();
    const today = await this.countRecentUserSwaps(params.userId, windowStart);
    if (today < params.requiredCount) {
      return {
        ok: false,
        message: `You have made ${today}/${params.requiredCount} swap(s) today. Swap CC ↔ USDCx to complete this task.`,
      };
    }
    return { ok: true };
  }

  /* ─── New daily send/receive variants (CC + USDCx, internal vs external) ─── */

  /**
   * Resolve a set of candidate counterparty partyIds against the User table
   * (batched, case-insensitive) and return the normalized partyIds that match a
   * known CanQuest user. Reused by the send-to-user and receive-internal filters.
   */
  private async resolveCanQuestCounterparties(
    candidates: Iterable<string>,
  ): Promise<{ isCq: Set<string>; notCq: Set<string> }> {
    const normalized = new Set<string>();
    for (const raw of candidates) {
      const n = normalizeCantonPartyId(raw);
      if (n) normalized.add(n);
    }
    if (normalized.size === 0) return { isCq: new Set(), notCq: new Set() };
    const matches = await this.prisma.user.findMany({
      where: { cantonPartyId: { in: [...normalized], mode: 'insensitive' } },
      select: { cantonPartyId: true },
    });
    const isCq = new Set<string>();
    for (const m of matches) {
      const n = normalizeCantonPartyId(m.cantonPartyId);
      if (n) isCq.add(n);
    }
    const notCq = new Set<string>();
    for (const n of normalized) if (!isCq.has(n)) notCq.add(n);
    return { isCq, notCq };
  }

  /** Count today's outgoing CC + token sends (combined) — for send_any_daily. */
  private async countSendAnyToday(userId: string, since: Date): Promise<number> {
    const [cc, token] = await Promise.all([
      this.countRecentUserSends(userId, since),
      this.countRecentUserTokenSends(userId, since),
    ]);
    return cc + token;
  }

  /** Verify send_any_daily: wallet + ≥ requiredCount outgoing CC/USDCx sends today. */
  private async verifySendAnyDaily(params: {
    userId: string;
    userPartyId: string;
    requiredCount: number;
  }): Promise<{ ok: boolean; message?: string }> {
    if (!this.hasRealWallet(params.userPartyId)) {
      return {
        ok: false,
        message: 'Create your Canton wallet first to complete this task.',
      };
    }
    const since = startOfTodayUtc();
    const total = await this.countSendAnyToday(params.userId, since);
    if (total < params.requiredCount) {
      return {
        ok: false,
        message: `You have sent ${total}/${params.requiredCount} CC/USDCx transaction(s) today. Send more to complete this task.`,
      };
    }
    return { ok: true };
  }

  /**
   * Collect today's outgoing counterparties (CC + token). For CC TRANSFER_OUT the
   * counterparty is stored in `referenceId` directly; for token TOKEN_TRANSFER_OUT
   * it is stored as `to:{partyId}` (strip the `to:` prefix). Fees are excluded.
   */
  private async collectTodayOutgoingCounterparties(
    userId: string,
    since: Date,
  ): Promise<string[]> {
    const [ccRows, tokenRows] = await Promise.all([
      this.prisma.ccTransaction.findMany({
        where: {
          userId,
          type: 'TRANSFER_OUT',
          status: 'COMPLETED',
          createdAt: { gte: since },
        },
        select: { referenceId: true, description: true },
      }),
      this.prisma.tokenTransaction.findMany({
        where: {
          userId,
          type: 'TOKEN_TRANSFER_OUT',
          status: 'COMPLETED',
          createdAt: { gte: since },
        },
        select: { referenceId: true },
      }),
    ]);
    const out: string[] = [];
    for (const r of ccRows) {
      if (isFeeTransactionRow(r.referenceId, r.description)) continue;
      if (r.referenceId) out.push(r.referenceId);
    }
    for (const r of tokenRows) {
      const ref = r.referenceId;
      if (!ref) continue;
      const pid = ref.startsWith('to:') ? ref.slice(3) : ref;
      if (pid) out.push(pid);
    }
    return out;
  }

  /**
   * Count today's outgoing sends whose recipient is a registered CanQuest user.
   * Uses a single batched lookup to avoid N+1. For send_to_user_daily progress.
   */
  private async countSendToUserToday(
    userId: string,
    since: Date,
  ): Promise<number> {
    const candidates = await this.collectTodayOutgoingCounterparties(userId, since);
    if (candidates.length === 0) return 0;
    const { isCq } = await this.resolveCanQuestCounterparties(candidates);
    let count = 0;
    for (const raw of candidates) {
      const n = normalizeCantonPartyId(raw);
      if (n && isCq.has(n)) count++;
    }
    return count;
  }

  /** Verify send_to_user_daily: wallet + ≥ requiredCount sends to a CQ user today. */
  private async verifySendToUserDaily(params: {
    userId: string;
    userPartyId: string;
    requiredCount: number;
  }): Promise<{ ok: boolean; message?: string }> {
    if (!this.hasRealWallet(params.userPartyId)) {
      return {
        ok: false,
        message: 'Create your Canton wallet first to complete this task.',
      };
    }
    const since = startOfTodayUtc();
    const count = await this.countSendToUserToday(params.userId, since);
    if (count < params.requiredCount) {
      return {
        ok: false,
        message: `You have sent ${count}/${params.requiredCount} transaction(s) to a CanQuest user today. Send to a CanQuest user to complete this task.`,
      };
    }
    return { ok: true };
  }

  /**
   * Collect today's incoming CC TRANSFER_IN rows. `withSender` distinguishes the
   * two sources of inbound rows:
   *   - rows whose ledgerTxId starts with "inbound-sync:" have NO real sender
   *     (referenceId = self); exclude unless the new indexer extension rewrote
   *     them with a real updateId + sender.
   *   - rows created by the app's send/accept paths carry the real counterparty
   *     in referenceId.
   * External sender = referenceId is a real partyId but not a CanQuest user.
   */
  private async collectTodayIncomingCounterparties(
    userId: string,
    since: Date,
  ): Promise<{ ccRows: { referenceId: string | null; ledgerTxId: string | null }[] }> {
    const ccRows = await this.prisma.ccTransaction.findMany({
      where: {
        userId,
        type: 'TRANSFER_IN',
        status: 'COMPLETED',
        createdAt: { gte: since },
      },
      select: { referenceId: true, ledgerTxId: true },
    });
    return { ccRows };
  }

  /**
   * Count today's inbound transfers from a NON-CanQuest sender. Requires the
   * indexer extension (Phase 1.5) to persist the real sender partyId in
   * referenceId with a real updateId in ledgerTxId. Legacy `inbound-sync:` rows
   * (referenceId = self, ledgerTxId = "inbound-sync:…") are skipped — they have
   * no sender identity.
   *
   * Optional `ownPartyId` excludes the user's own partyId (legacy self-ref rows).
   */
  private async countReceiveExternalToday(
    userId: string,
    since: Date,
    ownPartyId: string | null | undefined,
  ): Promise<number> {
    const { ccRows } = await this.collectTodayIncomingCounterparties(userId, since);
    const candidates: string[] = [];
    for (const r of ccRows) {
      // Skip legacy balance-sync rows with no sender identity.
      if (r.ledgerTxId?.startsWith('inbound-sync:')) continue;
      if (!r.referenceId) continue;
      // Skip self-referential rows (legacy inbound-sync fallback).
      if (ownPartyId && cantonPartyIdsEqual(r.referenceId, ownPartyId)) continue;
      candidates.push(r.referenceId);
    }
    if (candidates.length === 0) return 0;
    const { notCq } = await this.resolveCanQuestCounterparties(candidates);
    let count = 0;
    for (const raw of candidates) {
      const n = normalizeCantonPartyId(raw);
      if (n && notCq.has(n)) count++;
    }
    return count;
  }

  /** Verify receive_external_daily: ≥ requiredCount inbound from external wallet today. */
  private async verifyReceiveExternalDaily(params: {
    userId: string;
    userPartyId: string;
    requiredCount: number;
  }): Promise<{ ok: boolean; message?: string }> {
    if (!this.hasRealWallet(params.userPartyId)) {
      return {
        ok: false,
        message: 'Create your Canton wallet first to complete this task.',
      };
    }
    const since = startOfTodayUtc();
    const count = await this.countReceiveExternalToday(
      params.userId,
      since,
      params.userPartyId,
    );
    if (count < params.requiredCount) {
      return {
        ok: false,
        message: `You have received ${count}/${params.requiredCount} transaction(s) from an external wallet today. Receive CC/USDCx from an external wallet to complete this task.`,
      };
    }
    return { ok: true };
  }

  /**
   * Count today's inbound transfers from a registered CanQuest user. Includes:
   *   - CC TRANSFER_IN rows whose referenceId resolves to a CQ user (from the app
   *     send/accept path) AND whose ledgerTxId is NOT the legacy "inbound-sync:".
   *   - Token TOKEN_TRANSFER_IN rows (only created on internal accept).
   */
  private async countReceiveInternalToday(
    userId: string,
    since: Date,
  ): Promise<number> {
    const [ccCount, tokenCount] = await Promise.all([
      (async () => {
        const { ccRows } = await this.collectTodayIncomingCounterparties(userId, since);
        const candidates: string[] = [];
        for (const r of ccRows) {
          if (r.ledgerTxId?.startsWith('inbound-sync:')) continue;
          if (r.referenceId) candidates.push(r.referenceId);
        }
        if (candidates.length === 0) return 0;
        const { isCq } = await this.resolveCanQuestCounterparties(candidates);
        let count = 0;
        for (const raw of candidates) {
          const n = normalizeCantonPartyId(raw);
          if (n && isCq.has(n)) count++;
        }
        return count;
      })(),
      this.prisma.tokenTransaction.count({
        where: {
          userId,
          type: 'TOKEN_TRANSFER_IN',
          status: 'COMPLETED',
          createdAt: { gte: since },
        },
      }),
    ]);
    return ccCount + tokenCount;
  }

  /** Verify receive_internal_daily: ≥ requiredCount inbound from a CQ user today. */
  private async verifyReceiveInternalDaily(params: {
    userId: string;
    userPartyId: string;
    requiredCount: number;
  }): Promise<{ ok: boolean; message?: string }> {
    if (!this.hasRealWallet(params.userPartyId)) {
      return {
        ok: false,
        message: 'Create your Canton wallet first to complete this task.',
      };
    }
    const since = startOfTodayUtc();
    const count = await this.countReceiveInternalToday(params.userId, since);
    if (count < params.requiredCount) {
      return {
        ok: false,
        message: `You have received ${count}/${params.requiredCount} transaction(s) from a CanQuest user today. Receive CC/USDCx from a CanQuest user to complete this task.`,
      };
    }
    return { ok: true };
  }

  /**
   * Verify a lock-cc task: wallet required + the user holds (or has held) a
   * LOCKED CcLock whose lockSeconds is >= the tier threshold.
   *
   * CASCADE: when this tier verifies, every sibling lock-cc task in the same
   * quest whose threshold is LOWER and is not yet VERIFIED is auto-completed
   * (submission VERIFIED + points credited). e.g. verifying 15d auto-completes
   * 7d and 3d, yielding 150+60+20 = 230 points total for the 15d lock.
   */
  private async verifyLockCcTask(params: {
    userId: string;
    userPartyId: string;
    questId: string;
    taskId: string;
    target: string | null | undefined;
    points: number;
  }): Promise<{ ok: boolean; message?: string; cascaded: string[] }> {
    if (!this.hasRealWallet(params.userPartyId)) {
      return {
        ok: false,
        message: 'Create your Canton wallet first to complete this task.',
        cascaded: [],
      };
    }
    const tierSeconds = this.lockCcTierSeconds(params.target);
    const qualifying = await this.prisma.ccLock.findFirst({
      where: { userId: params.userId, lockSeconds: { gte: tierSeconds } },
      select: { id: true },
    });
    if (!qualifying) {
      const days = Math.round(tierSeconds / (24 * 60 * 60));
      return {
        ok: false,
        message: `Lock CC for at least ${days} day(s) to complete this task.`,
        cascaded: [],
      };
    }

    // Cascade: auto-complete lower-tier sibling lock-cc tasks in the same quest.
    const cascaded: string[] = [];
    const siblings = await this.prisma.questTask.findMany({
      where: { questId: params.questId, type: 'lock_cc', id: { not: params.taskId } },
      select: { id: true, target: true, points: true },
    });
    const now = new Date();
    for (const sib of siblings) {
      const sibSeconds = this.lockCcTierSeconds(sib.target);
      if (sibSeconds >= tierSeconds) continue; // only lower tiers cascade
      const existing = await this.prisma.questSubmission.findUnique({
        where: { userId_taskId: { userId: params.userId, taskId: sib.id } },
      });
      if (existing?.status === SubmissionStatus.VERIFIED) continue;
      if (existing) {
        await this.prisma.questSubmission.update({
          where: { id: existing.id },
          data: { proof: 'lock_cascade', status: SubmissionStatus.VERIFIED, verifiedAt: now, submittedAt: now },
        });
      } else {
        await this.prisma.questSubmission.create({
          data: {
            userId: params.userId,
            questId: params.questId,
            taskId: sib.id,
            proof: 'lock_cascade',
            status: SubmissionStatus.VERIFIED,
            verifiedAt: now,
            submittedAt: now,
          },
        });
      }
      await this.users.creditEarnPoints(params.userId, sib.points);
      cascaded.push(sib.id);
      this.logger.log(
        `Lock cascade: user=${params.userId.slice(0, 8)} tier=${tierSeconds}s auto-completed sibling=${sib.id.slice(0, 8)} (${sibSeconds}s) +${sib.points}pts`,
      );
    }
    return { ok: true, cascaded };
  }

  private canAutoVerify(
    type: string,
    correctAnswer: string | null,
    proof?: string,
  ): boolean {
    const t = this.normalizeTaskType(type);
    switch (t) {
      case 'quiz_yes_no':
        if (!correctAnswer || !proof) return false;
        return (
          proof.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
        );
      case 'quiz_choice':
        if (!correctAnswer || !proof) return false;
        return (
          proof.trim().toUpperCase() === correctAnswer.trim().toUpperCase()
        );
      case 'daily_check_in':
        return true;
      case 'send_transaction':
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
    taskId: string,
    taskType: string,
    taskTarget: string | null,
  ): Promise<void> {
    // Cooldown server-side 15 detik per (user, task). Mendukung countdown
    // frontend 5 detik (TASK_COUNTDOWN_SEC) DAN melindungi dari bypass:
    // double-click, network replay, multi-tab, dan bot. SET NX EX di Redis
    // → atomic. Bila Redis down, acquireCooldown() return true (tidak blokir).
    const cdKey = this.twitterCache.cooldownKey(userId, taskId);
    const gotSlot = await this.twitterCache.acquireCooldown(cdKey, 15);
    if (!gotSlot) {
      throw new BadRequestException(
        'Please wait a few seconds before verifying this task again.',
      );
    }

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
