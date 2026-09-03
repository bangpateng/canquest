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
import { ClaimOfferService } from '../canton/v30/claim-offer.service';
import { SigningRelayService } from '../canton/signing-relay.service';
import { isV30Quest, v30ClaimModel } from '../canton/v30/v30.constants';
import { CcInboundSyncService } from '../canton/cc-inbound-sync.service';
import { SpliceValidatorService } from '../canton/splice-validator.service';
import { LockEligibilityService } from '../canton/lock-eligibility.service';
import {
  TokenInstrumentHelper,
  normalizeRewardToken,
  type RewardTokenSymbol,
} from '../canton/token-instrument.helper';
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
  ROLLING_24H_MS,
  isWithin24h,
  msUntil24hExpires,
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
    private readonly users: UsersService,
    private readonly points: PointsService,
    private readonly twitterApi: TwitterApiService,
    private readonly twitterCache: TwitterCacheService,
    private readonly splice: SpliceValidatorService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly config: ConfigService,
    private readonly storage: R2StorageService,
    private readonly lockEligibility: LockEligibilityService,
    private readonly tokenInstrument: TokenInstrumentHelper,
    private readonly signRelay: SigningRelayService,
    private readonly claimOffers: ClaimOfferService,
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
        ledgerPackage: true,
      },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    // ── v30: eligibility PER-EVENT ──────────────────────────────────────────
    // Spesifikasi owner: 1 event = 1 lock. Lock campaign lain TIDAK membuat
    // user eligible di sini — hanya lock yang diverifikasi utk QUEST INI
    // (CampaignEligibilityLedger per quest, hasil verifikasi ledger holders=
    // [validator]). Tanpa ini badge menampilkan tier global yang menyesatkan.
    if (isV30Quest(quest)) {
      const perEvent = await this.prisma.campaignEligibilityLedger.findFirst({
        where: { questId, userId, status: 'ELIGIBLE' },
        select: { amount: true },
      });
      const eligible = !!perEvent;
      const amount = perEvent?.amount ?? 0;
      return {
        eligible,
        mode: quest.entryGateMode as EntryGateMode,
        ccLockAmount: quest.entryCcLock ?? 0,
        entryCostPoints: quest.entryCostPoints ?? 0,
        lockedCc: amount,
        netPoints: 0,
        hasEntry: false,
        reason: eligible
          ? `Lock verified for this event (${amount} CC).`
          : `Lock ${(quest.entryCcLock ?? 0).toString()} CC for THIS event to join — locks from other events don't count.`,
      };
    }

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
    rewardType: string;
    maxWinners: number | null;
    questKind?: string;
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
  requiresDrawCcClaim(quest: { rewardType: string }): boolean {
    return (
      normalizeRewardType(quest.rewardType as RewardType) ===
      RewardType.CC_MANUAL
    );
  }

  /** CC + Code combined raffle: admin draw after event; winners claim both CC and invite code. */
  requiresCcAndCodeRaffleClaim(quest: { rewardType: string }): boolean {
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
    // v30: slot FCFS PERMANEN sampai offer/diklaim (bukan reservasi 5 menit) —
    // tanpa pengecualian ini, sweeper menghapus slot v30 yang sah (bug
    // terbukti gladi 2026-09-03: slot hilang sebelum T2).
    const result = await tx.winnerDraw.deleteMany({
      where: {
        questId,
        distributed: false,
        drawnAt: { lt: cutoff },
        quest: { is: { ledgerPackage: { not: 'canquest-v30' } } },
      },
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

  /**
   * v24: rewardSender WAJIB non-null utk co-controller Settle (DAML multi-party).
   * Resolve rewardPartyId atau throw dgn pesan jelas. Dipakai oleh semua
   * claim path (FCFS/Raffle/Code/CC+Code) yg kirim rewardSenderPartyId ke
   * claimFcfsSlot/drawRaffleWinner.
   */
  private requireRewardPartyId(): string {
    const id = this.rewardPartyId;
    if (!id) {
      throw new Error(
        'CANTON_REWARD_PARTY_ID not configured (required for v24 atomic Settle)',
      );
    }
    return id;
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

  /**
   * v25: Check eligibility status WITHOUT throwing (utk pre-check UI / endpoint).
   * Return structured object: { eligible, reason, action }.
   * Dipakai oleh GET /quests/:id/eligibility-status + resolveEligibilityCid.
   *
   * Logic:
   *   eligibilityType = NONE → eligible: true (no check)
   *   LOCK_CC: cek ccLocks (LOCKED) — amount >= min + latestLockAt > campaignCreatedAt
   *   POINTS : cek PointsService.getNetPoints >= min
   *
   * Tidak touch DAML (read-only). Tidak create CampaignEligibility contract.
   */
  async checkEligibilityStatus(params: {
    userId: string;
    eligibilityType: string; // quest.eligibilityType (NONE|LOCK_CC|POINTS)
    eligibilityAmount: number; // quest.eligibilityAmount
    campaignCreatedAt: string; // ISO quest.createdAt (utk lock-after guard)
  }): Promise<{
    eligible: boolean;
    reason: string | null;
    action: string | null;
    currentAmount?: number;
  }> {
    const { userId, eligibilityType, eligibilityAmount, campaignCreatedAt } =
      params;

    if (eligibilityType === 'NONE' || eligibilityAmount <= 0) {
      return { eligible: true, reason: null, action: null };
    }

    if (eligibilityType === 'LOCK_CC') {
      const locks = await this.prisma.ccLock.findMany({
        where: { userId, status: 'LOCKED' },
        select: { amountCc: true, lockedAt: true },
        orderBy: { lockedAt: 'desc' },
      });
      const totalLocked = locks.reduce((s, l) => s + Number(l.amountCc), 0);
      if (totalLocked < eligibilityAmount) {
        return {
          eligible: false,
          currentAmount: totalLocked,
          reason: `Insufficient locked CC (${totalLocked.toFixed(2)} / ${eligibilityAmount} CC required).`,
          action: `Lock at least ${eligibilityAmount} CC to participate in this campaign.`,
        };
      }
      const latestLockAt = locks[0]?.lockedAt;
      if (!latestLockAt) {
        return {
          eligible: false,
          currentAmount: 0,
          reason: 'No active CC lock found.',
          action: 'Lock CC to participate in this campaign.',
        };
      }
      if (
        new Date(latestLockAt).getTime() <=
        new Date(campaignCreatedAt).getTime()
      ) {
        return {
          eligible: false,
          currentAmount: totalLocked,
          reason: 'Your CC lock is older than this campaign.',
          action: 'Unlock and re-lock your CC now to become eligible.',
        };
      }
      return {
        eligible: true,
        reason: null,
        action: null,
        currentAmount: totalLocked,
      };
    }

    if (eligibilityType === 'POINTS') {
      const netPoints = await this.points.getNetPoints(userId);
      if (netPoints < eligibilityAmount) {
        return {
          eligible: false,
          currentAmount: netPoints,
          reason: `Insufficient points (${netPoints} / ${eligibilityAmount} required).`,
          action: 'Complete more quests to earn points.',
        };
      }
      return {
        eligible: true,
        reason: null,
        action: null,
        currentAmount: netPoints,
      };
    }

    // Unknown type → treat as eligible (defensive)
    return { eligible: true, reason: null, action: null };
  }
  /**
   * v25: Resolve (or create) DAML CampaignEligibility contract id utk user+quest.
   * Dipanggil oleh 5 claim path sebelum claimFcfsSlot/drawRaffleWinner.
   * Pre-check via checkEligibilityStatus (throw BadRequestException dgn pesan EN),
   * lalu create CampaignEligibility contract bila eligible.
   *
   * Best-effort: kalau create DAML gagal, return null (claim tetap jalan, DAML guard
   * akan reject bila eligibility wajib). Idempoten via commandId.
   */
  /**
   * Version-pinning (cutover v28→v29): paket kontrak on-chain quest.
   * Quest baru menyimpan nama paket di kolom ledgerPackage; quest lama
   * (kolom null tapi sudah punya kontrak) = dibuat backend lama = v28.
   */
  private static ledgerPackageOf(quest: {
    ledgerPackage?: string | null;
    ledgerCampaignId?: string | null;
  }): string | null {
    if (quest.ledgerPackage) return quest.ledgerPackage;
    return quest.ledgerCampaignId ? 'canquest-v28' : null;
  }

  /**
   * ClaimSlot/DrawWinner adalah choice CONSUMING: kontrak campaign lama
   * ter-archive dan penerusnya (currentClaims+1) dibuat tiap klaim.
   * Persist cid penerus ke Quest.ledgerCampaignId supaya klaim berikutnya
   * tidak CONTRACT_NOT_FOUND (sebelum fix, klaim 2..N diam-diam jatuh ke
   * jalur non-atomic — audit trail on-chain hilang). Best-effort, non-block.
   */
  private async refreshLedgerCampaignId(
    questId: string,
    campaignCid: string | null | undefined,
  ): Promise<void> {
    if (!campaignCid) return;
    await this.prisma.quest
      .update({
        where: { id: questId },
        data: { ledgerCampaignId: campaignCid },
      })
      .catch((err) =>
        this.logger.warn(
          `refreshLedgerCampaignId fail quest=${questId.slice(0, 8)}: ${String(err)}`,
        ),
      );
  }

  /**
   * Tandai cache CampaignEligibilityLedger user+quest sebagai USED.
   * Choice UseEligibility bersifat CONSUMING (kontrak ter-archive saat
   * dipakai ClaimSlot/DrawWinner) — tanpa penandaan ini, retry klaim akan
   * mengirim cid eligibility yang sudah mati dan gagal "could not be found"
   * di dalam choice body. Baris REVOKED/EXPIRED tidak tersentuh.
   */
  private async markEligibilityUsed(
    questId: string,
    userId: string,
  ): Promise<void> {
    await this.prisma.campaignEligibilityLedger
      .updateMany({
        where: { questId, userId, status: 'ELIGIBLE' },
        data: { status: 'USED', updatedAt: new Date() },
      })
      .catch((err) =>
        this.logger.warn(
          `markEligibilityUsed fail quest=${questId.slice(0, 8)}: ${String(err)}`,
        ),
      );
  }

  private async resolveEligibilityCid(params: {
    questId: string;
    userId: string;
    userPartyId: string;
    eligibilityType: string; // quest.eligibilityType (NONE|LOCK_CC|POINTS)
    eligibilityAmount: number; // quest.eligibilityAmount
    campaignCreatedAt: string; // ISO quest.createdAt (utk lock-after guard)
    /** Version-pinning: paket kontrak campaign quest ini. */
    ledgerPackage?: string | null;
  }): Promise<{ eligibilityCid: string | null; lockCid: string | null }> {
    const {
      questId,
      userId,
      userPartyId,
      eligibilityType,
      eligibilityAmount,
      campaignCreatedAt,
      ledgerPackage,
    } = params;

    // ── LEGACY v28: semantik lama — "NONE" sah (tanpa proof on-chain),
    //    tanpa CoinLock, kontrak dibuat di paket v28.
    if (ledgerPackage === 'canquest-v28') {
      if (eligibilityType === 'NONE' || eligibilityAmount <= 0)
        return { eligibilityCid: null, lockCid: null };
      const cached = await this.prisma.campaignEligibilityLedger.findFirst({
        where: { questId, userId, status: 'ELIGIBLE' },
        select: { contractId: true },
      });
      if (cached?.contractId)
        return { eligibilityCid: cached.contractId, lockCid: null };
      const status = await this.checkEligibilityStatus({
        userId,
        eligibilityType,
        eligibilityAmount,
        campaignCreatedAt,
      });
      if (!status.eligible) {
        const detail = status.reason ? ` ${status.reason}` : '';
        throw new BadRequestException(
          `Not eligible to claim this campaign.${detail}${status.action ? ` ${status.action}` : ''}`,
        );
      }
      const amount = status.currentAmount ?? 0;
      let lockedAt: string | null = null;
      if (eligibilityType === 'LOCK_CC') {
        const locks = await this.prisma.ccLock.findMany({
          where: { userId, status: 'LOCKED' },
          select: { lockedAt: true },
          orderBy: { lockedAt: 'desc' },
        });
        const latestLockAt = locks[0]?.lockedAt;
        lockedAt = latestLockAt ? new Date(latestLockAt).toISOString() : null;
      }
      const typeForDaml: 'LOCK_CC' | 'POINTS' =
        eligibilityType === 'POINTS' ? 'POINTS' : 'LOCK_CC';
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 3600 * 1000,
      ).toISOString();
      const result = await this.questLedger.createCampaignEligibility({
        userPartyId,
        campaignId: questId,
        campaignCreatedAt,
        eligibilityType: typeForDaml,
        amount,
        lockedAt,
        expiresAt,
        ledgerPackage,
      });
      if (!result.ok || !result.contractId) {
        this.logger.warn(
          `Eligibility create fail (v28): ${result.errors.join(' | ')}`,
        );
        return { eligibilityCid: null, lockCid: null };
      }
      await this.prisma.campaignEligibilityLedger.upsert({
        where: { questId_userId: { questId, userId } },
        create: {
          questId,
          userId,
          contractId: result.contractId,
          eligibilityType: typeForDaml,
          amount,
          lockedAt: lockedAt ? new Date(lockedAt) : null,
          status: 'ELIGIBLE',
        },
        update: {
          contractId: result.contractId,
          eligibilityType: typeForDaml,
          amount,
          lockedAt: lockedAt ? new Date(lockedAt) : null,
          status: 'ELIGIBLE',
        },
      });
      return { eligibilityCid: result.contractId, lockCid: null };
    }

    // ── v29: semantik baru.
    // v29 [FIX-14]: "NONE" TIDAK sah di kontrak (campaign dibuat dgn
    // eligibilityType POINTS amount 0 oleh quest-ledger). Semua claim kini
    // WAJIB menyertakan eligibility proof → map NONE → POINTS auto-proof
    // (tanpa gate; amount 0 → guard e.amount >= 0 trivially lulus).
    const typeForDaml: 'LOCK_CC' | 'POINTS' =
      eligibilityType === 'LOCK_CC' ? 'LOCK_CC' : 'POINTS';
    const gated = typeForDaml === 'LOCK_CC' || eligibilityAmount > 0;

    // 1. Cek cache (CampaignEligibilityLedger)
    const cached = await this.prisma.campaignEligibilityLedger.findFirst({
      where: { questId, userId, status: 'ELIGIBLE' },
      select: { contractId: true, eligibilityType: true, coinLockCid: true },
    });
    if (cached?.contractId) {
      // LOCK_CC butuh lockCid utk choice arg — pastikan CoinLock resolved.
      if (typeForDaml !== 'LOCK_CC' || cached.coinLockCid) {
        return {
          eligibilityCid: cached.contractId,
          lockCid: cached.coinLockCid,
        };
      }
      // Legacy row tanpa coinLockCid → jatuh ke bawah utk resolve CoinLock,
      // lalu update cache (eligibility contract lama tetap dipakai).
    }

    // 2. Pre-check eligibility (throw EN error bila tidak eligible — dipakai UI juga)
    //    Auto-proof (NONE→POINTS amount 0) TIDAK dicek — memang tanpa gate.
    let amount = 0;
    let lockedAt: string | null = null;
    let lockSeconds = 0;
    let lockExpiresAt: Date | null = null;

    if (gated) {
      const status = await this.checkEligibilityStatus({
        userId,
        eligibilityType,
        eligibilityAmount,
        campaignCreatedAt,
      });
      if (!status.eligible) {
        const detail = status.reason ? ` ${status.reason}` : '';
        throw new BadRequestException(
          `Not eligible to claim this campaign.${detail}${status.action ? ` ${status.action}` : ''}`,
        );
      }
      amount = status.currentAmount ?? 0;
    }

    if (typeForDaml === 'LOCK_CC') {
      const locks = await this.prisma.ccLock.findMany({
        where: { userId, status: 'LOCKED' },
        select: { lockedAt: true, lockSeconds: true, expiresAt: true },
        orderBy: { lockedAt: 'desc' },
      });
      const latest = locks[0];
      lockedAt = latest?.lockedAt
        ? new Date(latest.lockedAt).toISOString()
        : null;
      lockSeconds = latest?.lockSeconds ?? 0;
      lockExpiresAt =
        locks.reduce<Date | null>(
          (max, l) => (!max || l.expiresAt > max ? l.expiresAt : max),
          null,
        ) ?? null;
    }

    // 3. LOCK_CC v29: ensure CoinLock on-chain (FIX-11 cross-check lockId).
    //    CoinLock amount HARUS == eligibility amount (guard kontrak), jadi
    //    dibuat per (quest, user) dgn lockId deterministik.
    let lockCid: string | null = null;
    if (typeForDaml === 'LOCK_CC') {
      const lockId = `lock:${questId}:${userId}`;
      const coinLock = await this.questLedger.createCoinLock({
        userPartyId,
        lockId,
        amount,
        durationDays: QuestsService.nearestCoinLockDays(lockSeconds),
        lockedAt: lockedAt ?? new Date().toISOString(),
        expiresAt: (
          lockExpiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000)
        ).toISOString(),
        campaignId: questId,
      });
      if (coinLock.ok && coinLock.contractId) {
        lockCid = coinLock.contractId;
      } else {
        // Best-effort: lanjut tanpa lockCid — DAML guard akan menolak klaim
        // LOCK_CC (fail-safe, tidak ada dana bergerak).
        this.logger.warn(
          `CoinLock create fail (claim LOCK_CC akan ditolak on-chain): ${coinLock.errors.join(' | ')}`,
        );
      }
    }

    // 4. Create DAML CampaignEligibility contract (kalau belum ada di cache)
    let eligibilityCid = cached?.contractId ?? null;
    if (!eligibilityCid) {
      const expiresAt = new Date(
        Date.now() + 7 * 24 * 3600 * 1000,
      ).toISOString(); // 7 hari default
      const result = await this.questLedger.createCampaignEligibility({
        userPartyId,
        campaignId: questId,
        campaignCreatedAt,
        eligibilityType: typeForDaml,
        amount,
        lockedAt,
        expiresAt,
        lockId: typeForDaml === 'LOCK_CC' ? `lock:${questId}:${userId}` : null,
        ledgerPackage,
      });
      if (!result.ok || !result.contractId) {
        this.logger.warn(
          `Eligibility create fail: ${result.errors.join(' | ')}`,
        );
        return { eligibilityCid: null, lockCid };
      }
      eligibilityCid = result.contractId;
    }

    // 5. Persist ke cache
    await this.prisma.campaignEligibilityLedger.upsert({
      where: { questId_userId: { questId, userId } },
      create: {
        questId,
        userId,
        contractId: eligibilityCid,
        eligibilityType: typeForDaml,
        amount,
        lockedAt: lockedAt ? new Date(lockedAt) : null,
        status: 'ELIGIBLE',
        lockId: typeForDaml === 'LOCK_CC' ? `lock:${questId}:${userId}` : null,
        coinLockCid: lockCid,
      },
      update: {
        contractId: eligibilityCid,
        eligibilityType: typeForDaml,
        amount,
        lockedAt: lockedAt ? new Date(lockedAt) : null,
        status: 'ELIGIBLE',
        lockId: typeForDaml === 'LOCK_CC' ? `lock:${questId}:${userId}` : null,
        coinLockCid: lockCid,
      },
    });

    return { eligibilityCid, lockCid };
  }

  /**
   * v29: kontrak CoinLock hanya menerima durationDays 3|7|15. Term lock asli
   * (LOCK_TERM_OPTIONS — bisa menit utk uji, atau 30d di produksi) dipetakan
   * ke nilai terdekat; expiresAt CoinLock tetap menyimpan expiry ASLI.
   */
  private static nearestCoinLockDays(lockSeconds: number): 3 | 7 | 15 {
    const days = lockSeconds / 86400;
    const options: Array<3 | 7 | 15> = [3, 7, 15];
    return options.reduce((best, cur) =>
      Math.abs(cur - days) < Math.abs(best - days) ? cur : best,
    );
  }

  /**
   * Feature flag: atomic Settle path (DAML v22/v23).
   * - true  → settleAndRecord (atomic fee+reward via nested-exercise Settle)
   * - false → fallback path (collectClaimFee + sendQuestRewardAndRecord terpisah,
   *           non-atomic seperti v21)
   *
   * Default true bila isClaimSessionConfigured (DAML ledger on). Set
   * QUEST_ATOMIC_SETTLE=false utk emergency kill-switch → fallback ke path lama.
   */
  private get useAtomicSettle(): boolean {
    const v = this.config
      .get<string>('QUEST_ATOMIC_SETTLE')
      ?.trim()
      .toLowerCase();
    if (v === 'false' || v === '0') return false;
    return this.questLedger.isClaimSessionConfigured();
  }

  /**
   * Ensure reward wallet (canquest-reward) can cover the payout before sending.
   * CC: cek via splice.getUserBalance (cache Splice). USDCx: cek via on-chain
   * balance (getTokenBalanceOnChain) karena Splice cache hanya CC.
   */
  private async assertRewardPool(
    amount: number,
    token: RewardTokenSymbol = 'CC',
  ): Promise<void> {
    if (amount <= 0) return; // tidak ada reward di-reserve — skip cek.
    const rewardPartyId = this.rewardPartyId;
    if (!rewardPartyId) {
      throw new Error('CANTON_REWARD_PARTY_ID not configured');
    }

    if (token === 'CC') {
      const rewardUsername = this.rewardSenderUsername;
      const balance = await this.splice.getUserBalance(rewardUsername);
      if (balance !== null && balance < amount) {
        throw new Error(
          `Reward wallet too low (@${rewardUsername} has ${balance.toFixed(2)} CC, need ${amount} CC)`,
        );
      }
      return;
    }

    // USDCx (dan token non-CC lain): baca on-chain via instrument id.
    const { instrumentId } =
      await this.tokenInstrument.resolveInstrument(token);
    const balance = await this.cantonLedger.getTokenBalanceOnChain(
      rewardPartyId,
      instrumentId,
    );
    if (balance < amount) {
      throw new Error(
        `Reward wallet too low for ${token} (${rewardPartyId.split('::')[0]} has ${balance.toFixed(2)} ${token}, need ${amount} ${token}). Top-up reward wallet first.`,
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
   * Kirim reward (CC atau USDCx) dari reward wallet → user, persist distributed,
   * record history, dan upsert QuestCompletion. Token-aware.
   *
   * Dipakai oleh semua claim flow (FCFS / Draw / Invite / Raffle) supaya logic
   * security C1 (anti double-payout) + history konsisten di satu tempat.
   *
   * Behavior:
   * - CC (default): sendReward Amulet + recordTransaction (CcTransaction) + rewardMicroCc.
   * - USDCx: resolve instrument → sendReward dgn instrumentId/Admin + recordTokenTransaction
   *   (TokenTransaction) + rewardTokenAmount. DAML receipt tetap CC-only (fee CC).
   *
   * Realtime: direct kalau user punya TransferPreapproval; offer (pending) kalau tidak.
   * Token sudah keluar reward wallet di kedua kasus → distributed=true selalu di-set
   * (irreversible on-chain).
   *
   * @returns { rewardTxId, pending } — pending=true artinya user harus accept offer di wallet.
   */
  private async sendQuestRewardAndRecord(params: {
    drawId: string;
    userId: string;
    questId: string;
    questTitle: string;
    cantonPartyId: string;
    username: string | null;
    rewardCc: number;
    rewardToken: RewardTokenSymbol;
    /** DAML claimSessionId untuk atomicFeeAndReward receipt (opsional, CC-only). */
    claimSessionId?: string | null;
    /** DAML fee txId untuk atomicFeeAndReward receipt. */
    feeTxId: string;
    /** Label utk log/description (mis. 'FCFS reward', 'Raffle reward'). */
    rewardLabel: string;
  }): Promise<{ rewardTxId: string; pending: boolean }> {
    const {
      drawId,
      userId,
      questId,
      questTitle,
      cantonPartyId,
      username,
      rewardCc,
      rewardToken,
      rewardLabel,
    } = params;

    const rewardPartyId = this.rewardPartyId;
    if (!rewardPartyId) {
      throw new Error('CANTON_REWARD_PARTY_ID not configured');
    }

    // Resolve instrument ref untuk USDCx (CC tidak perlu — default Amulet di sendReward).
    let instrumentId: string | undefined;
    let instrumentAdmin: string | undefined;
    if (rewardToken === 'USDCx') {
      const ref = await this.tokenInstrument.resolveInstrument('USDCx');
      instrumentId = ref.instrumentId;
      instrumentAdmin = ref.instrumentAdmin;
    }

    this.logger.log(
      `${rewardLabel}: ${rewardPartyId.split('::')[0]} → ${cantonPartyId.split('::')[0]} ` +
        `(@${username}, ${rewardCc} ${rewardToken}${instrumentId ? ` [${instrumentId}]` : ''})`,
    );

    // ── Kirim reward on-chain (CIP-56 TransferFactory) ──────────────────────
    const rewardResult = await this.cantonLedger.sendReward({
      senderPartyId: rewardPartyId,
      receiverPartyId: cantonPartyId,
      amountCc: rewardCc,
      description: `${rewardLabel} — ${questTitle}`,
      instrumentId,
      instrumentAdmin,
    });
    if (!rewardResult.ok) {
      throw new Error(rewardResult.error ?? 'reward transfer failed');
    }
    const rewardTxId =
      rewardResult.rewardTxId ?? `reward-${Date.now()}-${userId.slice(0, 8)}`;
    const rewardPending = rewardResult.pending;
    this.logger.log(
      `${rewardLabel} ${rewardCc} ${rewardToken} → ${cantonPartyId.split('::')[0]} ` +
        `(${rewardPending ? 'PENDING — user accepts in wallet' : 'direct'})`,
    );

    // ⚠️ SECURITY (C1): Persist distributed=true + ledgerTxId IMMEDIATELY after
    // sendReward succeeds. Token (CC atau USDCx) sudah keluar reward wallet
    // on-chain (irreversible). Jika step di bawah throw, retry short-circuit di
    // distributed=true check, BUKAN kirim reward lagi (double payout).
    await this.prisma.winnerDraw.updateMany({
      where: { id: drawId, distributed: false },
      data: {
        distributed: true,
        ledgerTxId: rewardTxId,
        distributedAt: new Date(),
        rewardToken,
      },
    });

    // DAML atomic receipt (DAML v21 AtomicFeeAndReward) sudah HAPUS di v22/v23.
    // Helper ini sekarang FALLBACK path (non-atomic) — dipakai kalau
    // settleAndRecord() tidak dipakai (feature flag off / kode path).
    // DAML receipt tidak ditulis di fallback (fee+reward di CIP-56 terpisah).
    // claimSessionId param tetap ada utk backward-compat tapi diabaikan di sini.

    // ── Record history (NON-FATAL — token sudah berpindah on-chain) ─────────
    try {
      if (rewardToken === 'CC') {
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
      } else {
        // USDCx → TokenTransaction (instrument-aware), BUKAN CcTransaction.
        const { instrumentId: instId, instrumentAdmin: instAdmin } =
          await this.tokenInstrument.resolveInstrument(rewardToken);
        await this.users.recordTokenTransaction({
          userId,
          instrumentId: instId,
          instrumentAdmin: instAdmin,
          amount: rewardCc,
          type: 'QUEST_REWARD',
          description: `Received ${rewardCc} ${rewardToken} reward`,
          referenceId: questId,
          ledgerTxId: rewardTxId,
          status: rewardPending ? 'PENDING' : 'COMPLETED',
          transferInstructionCid: rewardResult.transferInstructionCid ?? null,
        });
      }
    } catch (recordErr) {
      this.logger.error(
        `CLAIM_HISTORY_FAIL ${rewardLabel} quest=${questId.slice(0, 8)} user=@${username}: reward sent (txId=${rewardTxId}) but history record threw: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
      );
    }

    // Async balance sync (non-blocking) — CC saja (USDCx balance via ACS event handler).
    if (rewardToken === 'CC' && username) {
      void this.inboundSync
        .alignBalanceFromChain(userId, username)
        .catch((err) =>
          this.logger.warn(
            `Balance sync failed (non-blocking): ${String(err)}`,
          ),
        );
    }

    // ── Upsert QuestCompletion dgn token fields ─────────────────────────────
    if (rewardToken === 'CC') {
      const rewardMicroCc = BigInt(Math.round(rewardCc * 1_000_000));
      await this.prisma.questCompletion.upsert({
        where: { userId_questId: { userId, questId } },
        create: { userId, questId, rewardMicroCc, rewardToken: 'CC' },
        update: { rewardMicroCc, rewardToken: 'CC' },
      });
    } else {
      await this.prisma.questCompletion.upsert({
        where: { userId_questId: { userId, questId } },
        create: {
          userId,
          questId,
          rewardToken: 'USDCx',
          rewardTokenAmount: rewardCc,
        },
        update: { rewardToken: 'USDCx', rewardTokenAmount: rewardCc },
      });
    }

    return { rewardTxId, pending: rewardPending };
  }

  /**
   * settleAndRecord — DAML v22/v23 atomic Settle path.
   *
   * Pengganti sendQuestRewardAndRecord + collectClaimFee terpisah (non-atomic).
   * Fee+reward transfer terjadi DI DALAM Settle choice (nested-exercise) dalam
   * 1 transaction tree → atomic all-or-nothing.
   *
   * Flow:
   *   1. questLedger.settleAtomic({fee+reward params, claimContractId})
   *      → atomic CC movement + create QuestClaimReceipt SETTLED
   *   2. set distributed=true (C1 anti-double-payout, irreversible on-chain)
   *   3. questLedger.recordTxId (best-effort, post-settle audit)
   *   4. record history (CcTransaction/TokenTransaction)
   *   5. upsert QuestCompletion
   *
   * Bila rewardAmount=0 (kode claim), reward leg = None di Settle → fee-only
   * atomic. Reward history tidak ditulis (cuma fee CcTransaction).
   */
  private async settleAndRecord(params: {
    drawId: string;
    userId: string;
    questId: string;
    questTitle: string;
    cantonPartyId: string;
    username: string | null;
    claimContractId: string; // QuestClaimReceipt PRE_SETTLE
    feeAmount: number; // claimFeeCc
    rewardAmount: number; // rewardCc (0 utk kode claim)
    rewardToken: RewardTokenSymbol;
    rewardLabel: string;
  }): Promise<{ settledCid: string | null; updateId: string | null }> {
    const {
      drawId,
      userId,
      questId,
      questTitle,
      cantonPartyId,
      username,
      claimContractId,
      feeAmount,
      rewardAmount,
      rewardToken,
      rewardLabel,
    } = params;

    const rewardPartyId = this.rewardPartyId;
    const feePartyId = this.feeTargetPartyId;
    if (!rewardPartyId)
      throw new Error('CANTON_REWARD_PARTY_ID not configured');
    if (!feePartyId)
      throw new Error('CANTON_FEE_RECIPIENT_PARTY_ID not configured');

    // Resolve instrument untuk USDCx reward (CC default Amulet di settleAtomic).
    let rewardInstrumentId: string | undefined;
    let rewardInstrumentAdmin: string | undefined;
    if (rewardToken === 'USDCx' && rewardAmount > 0) {
      const ref = await this.tokenInstrument.resolveInstrument('USDCx');
      rewardInstrumentId = ref.instrumentId;
      rewardInstrumentAdmin = ref.instrumentAdmin;
    }

    this.logger.log(
      `${rewardLabel} (atomic Settle): fee ${feeAmount} CC → ${feePartyId.split('::')[0]}, ` +
        `reward ${rewardAmount} ${rewardToken}${rewardAmount > 0 ? ` → ${cantonPartyId.split('::')[0]}` : ' (none)'} ` +
        `(@${username})`,
    );

    // ── 1. ATOMIC SETTLE (fee + reward dalam 1 transaction tree) ────────────
    // Version-pinning: receipt mengikuti versi paket campaign quest ini.
    const questRow = await this.prisma.quest.findUnique({
      where: { id: questId },
      select: { ledgerPackage: true, ledgerCampaignId: true },
    });
    const ledgerPackage = QuestsService.ledgerPackageOf(questRow ?? {});
    const settleResult = await this.questLedger.settleAtomic({
      claimContractId,
      userPartyId: cantonPartyId,
      feeReceiverPartyId: feePartyId,
      feeAmount,
      rewardSenderPartyId: rewardPartyId,
      rewardAmount,
      rewardToken,
      rewardInstrumentId,
      rewardInstrumentAdmin,
      ledgerPackage,
    });
    if (!settleResult.ok) {
      throw new Error(
        `Atomic Settle failed: ${settleResult.errors.join(' | ')}`,
      );
    }
    const updateId =
      settleResult.updateId ?? `settle-${Date.now()}-${userId.slice(0, 8)}`;
    const settledCid = settleResult.settledCid;

    this.logger.log(
      `${rewardLabel} atomic Settle OK: settled=${settledCid?.slice(0, 12) ?? 'none'} updateId=${updateId.slice(0, 12)}`,
    );

    // ── 2. SECURITY C1: persist distributed=true SETELAH atomic settle ──────
    // Token sudah berpindah on-chain (irreversible, atomic). Retry short-circuit.
    await this.prisma.winnerDraw.updateMany({
      where: { id: drawId, distributed: false },
      data: {
        distributed: true,
        ledgerTxId: updateId,
        distributedAt: new Date(),
        rewardToken,
      },
    });

    // ── 3. recordTxId (post-settle audit, non-blocking) ─────────────────────
    if (settledCid) {
      // v25: rewardTxId Optional. Null bila kode claim (rewardAmount=0).
      const rewardTxIdValue = rewardAmount > 0 ? updateId : null;
      void this.questLedger
        .recordTxId({
          settledContractId: settledCid,
          feeTxId: updateId,
          rewardTxId: rewardTxIdValue,
          ledgerPackage,
        })
        .catch((err) =>
          this.logger.warn(`recordTxId fail (non-blocking): ${String(err)}`),
        );
    }

    // ── 4. Record history (NON-FATAL — atomic settle sudah committed) ──────
    try {
      // Fee record (selalu, CC). Reference 'fee:' supaya hidden dari user history.
      await this.users.recordTransaction({
        userId,
        amountCc: feeAmount,
        type: 'TRANSFER_OUT',
        description: `Claim fee — ${questTitle}`,
        referenceId: `fee:${questId}`,
        counterparty: feePartyId.split('::')[0],
        ledgerTxId: updateId,
        status: 'COMPLETED',
        transferInstructionCid: null,
      });
      // Reward record (hanya bila rewardAmount > 0)
      if (rewardAmount > 0) {
        // Atomic settle: fee & reward SATU updateId (1 tx tree) — constraint
        // CcTransaction @@unique(userId, ledgerTxId) menolak baris kedua.
        // Reward pakai ledgerTxId turunan ':r'; cantonUpdateId tetap id asli
        // supaya link explorer & dedupe berbasis updateId tetap benar.
        const rewardLedgerTxId = `${updateId}:r`;
        if (rewardToken === 'CC') {
          await this.users.recordTransaction({
            userId,
            amountCc: rewardAmount,
            type: 'QUEST_REWARD',
            description: `Received ${rewardAmount} CC reward`,
            referenceId: questId,
            counterparty: rewardPartyId.split('::')[0],
            ledgerTxId: rewardLedgerTxId,
            cantonUpdateId: updateId,
            status: 'COMPLETED',
            transferInstructionCid: null,
          });
        } else {
          const { instrumentId: instId, instrumentAdmin: instAdmin } =
            await this.tokenInstrument.resolveInstrument(rewardToken);
          await this.users.recordTokenTransaction({
            userId,
            instrumentId: instId,
            instrumentAdmin: instAdmin,
            amount: rewardAmount,
            type: 'QUEST_REWARD',
            description: `Received ${rewardAmount} ${rewardToken} reward`,
            referenceId: questId,
            ledgerTxId: `${updateId}:r`,
            status: 'COMPLETED',
            transferInstructionCid: null,
          });
        }
      }
    } catch (recordErr) {
      this.logger.error(
        `CLAIM_HISTORY_FAIL ${rewardLabel} quest=${questId.slice(0, 8)} user=@${username}: atomic settle committed (updateId=${updateId}) but history record threw: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
      );
    }

    // ── 5. Async balance sync (CC only, non-blocking) ───────────────────────
    if (rewardToken === 'CC' && username && rewardAmount > 0) {
      void this.inboundSync
        .alignBalanceFromChain(userId, username)
        .catch((err) =>
          this.logger.warn(
            `Balance sync failed (non-blocking): ${String(err)}`,
          ),
        );
    }

    // ── 6. Upsert QuestCompletion ───────────────────────────────────────────
    if (rewardAmount > 0) {
      if (rewardToken === 'CC') {
        const rewardMicroCc = BigInt(Math.round(rewardAmount * 1_000_000));
        await this.prisma.questCompletion.upsert({
          where: { userId_questId: { userId, questId } },
          create: { userId, questId, rewardMicroCc, rewardToken: 'CC' },
          update: { rewardMicroCc, rewardToken: 'CC' },
        });
      } else {
        await this.prisma.questCompletion.upsert({
          where: { userId_questId: { userId, questId } },
          create: {
            userId,
            questId,
            rewardToken: 'USDCx',
            rewardTokenAmount: rewardAmount,
          },
          update: { rewardToken: 'USDCx', rewardTokenAmount: rewardAmount },
        });
      }
    }

    return { settledCid, updateId };
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

  /**
   * Idempotent code reservation for claim flows.
   *
   * reserveInviteCode marks the pool row as assigned inside its own
   * transaction; if the claim then fails later (fee, settle, DB), the row
   * stays assigned but WinnerDraw.inviteCode is never persisted — a retry
   * would reserve a DIFFERENT code and leak the first one. Re-use the row
   * already assigned to this user before taking a fresh code.
   */
  private async reserveInviteCodeIdempotent(
    questId: string,
    userId: string,
  ): Promise<string | null> {
    const existing = await this.prisma.inviteCodePool.findFirst({
      where: { questId, userId },
      orderBy: { assignedAt: 'asc' },
    });
    if (existing) return existing.code;
    return this.reserveInviteCode(questId, userId);
  }

  /* ─── Quest list / detail ─── */

  /**
   * Jawaban kuis (correctAnswer) tidak boleh terekspos ke klien — verifikasi
   * jawaban hanya di server (submitTask). Admin panel memakai AdminService
   * sendiri yang tetap menyertakan jawaban untuk editing.
   */
  private stripTaskAnswers<T extends { tasks?: unknown[] }>(quest: T): T {
    if (!Array.isArray(quest.tasks)) return quest;
    return {
      ...quest,
      tasks: quest.tasks.map((task) => {
        const safe = { ...(task as Record<string, unknown>) };
        delete safe.correctAnswer;
        return safe;
      }),
    };
  }

  async listQuests(status?: QuestStatus) {
    const quests = await this.prisma.quest.findMany({
      where: { questKind: QuestKind.CAMPAIGN },
      include: { tasks: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    const mapped = quests.map((q) =>
      this.stripTaskAnswers(
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
      rewardType?: string;
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
      rewardType: string;
      rewardCc: number;
      maxWinners: number | null;
      claimFeeCc?: number | null;
      questKind?: string;
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

    const isInviteCodeFcfs = (q: { rewardType: string }) =>
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
    // v30: slot FCFS permanen — jangan dianggap reservasi basi (lihat atas).
    const result = await tx.winnerDraw.deleteMany({
      where: {
        questId: { in: questIds },
        distributed: false,
        drawnAt: { lt: cutoff },
        quest: { is: { ledgerPackage: { not: 'canquest-v30' } } },
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
    return this.stripTaskAnswers({
      ...q,
      tags: this.parseTags(q.tags),
      socialLinks: parseQuestSocialLinks(q.socialLinks),
      rewardType: normalizeRewardType(q.rewardType),
      status: resolveQuestDisplayStatus(q),
    });
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
    const mapped = this.stripTaskAnswers(
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
    // Rolling-24h progress for daily (repeatable) tasks: taskIds whose last
    // verification is within the past 24h. The frontend renders this as a
    // "today's progress" bar. This intentionally mirrors the rolling cooldown
    // gate (a task counts as "done today" while it is on cooldown).
    const rollingStart = new Date(Date.now() - ROLLING_24H_MS);
    const todayVerifiedTaskIds = submissions
      .filter((s) => s.verifiedAt && s.verifiedAt >= rollingStart)
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
        nt === 'send_to_external_daily' ||
        nt === 'receive_external_daily' ||
        nt === 'receive_internal_daily' ||
        nt === 'lock_cc_daily'
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
      sendToExternal,
      receiveExternal,
      receiveInternal,
      locksToday,
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
      byType['send_to_external_daily']?.length
        ? this.countSendToExternalToday(userId, windowStart)
        : Promise.resolve(0),
      byType['receive_external_daily']?.length
        ? this.countReceiveExternalToday(userId, windowStart, undefined)
        : Promise.resolve(0),
      byType['receive_internal_daily']?.length
        ? this.countReceiveInternalToday(userId, windowStart)
        : Promise.resolve(0),
      byType['lock_cc_daily']?.length
        ? this.countLocksCreatedToday(userId, windowStart)
        : Promise.resolve(0),
    ]);

    const counts: Record<string, number> = {
      send_transaction: ccSends,
      send_token: tokenSends,
      daily_swap: swaps,
      send_any_daily: sendAny,
      send_to_user_daily: sendToUser,
      send_to_external_daily: sendToExternal,
      receive_external_daily: receiveExternal,
      receive_internal_daily: receiveInternal,
      lock_cc_daily: locksToday,
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
  }): Promise<{
    status: SubmissionStatus;
    alreadyDone: boolean;
    nextCheckInAt?: string;
  }> {
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
        ledgerPackage: true,
      },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    // v30 (spesifikasi owner): tugas baru bisa dikerjakan SETELAH lock event
    // ini — lock campaign lain tidak berlaku (eligibility per-event).
    if (isV30Quest(quest) && v30ClaimModel(quest).requiresLock) {
      const eligible = await this.prisma.campaignEligibilityLedger.findFirst({
        where: { questId, userId, status: 'ELIGIBLE' },
        select: { id: true },
      });
      if (!eligible) {
        throw new BadRequestException(
          `Lock ${(quest.entryCcLock ?? 1).toString()} CC for this event first — tasks unlock after the lock.`,
        );
      }
    }

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
    const isSendToExternalDailyTask = taskType === 'send_to_external_daily';
    const isLockCcDailyTask = taskType === 'lock_cc_daily';
    const repeatable24h =
      quest.questKind === QuestKind.EARN_HUB &&
      (taskType === 'daily_check_in' ||
        isSendTxTask ||
        isSendTokenTask ||
        isDailySwapTask ||
        isSendAnyDailyTask ||
        isSendToUserDailyTask ||
        isReceiveExternalDailyTask ||
        isReceiveInternalDailyTask ||
        isSendToExternalDailyTask ||
        isLockCcDailyTask);

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
          // Rolling 24h cooldown: a repeat is allowed exactly 24h after the
          // user's last verification. This is a rolling window (not a
          // calendar-day reset) so every user faces the same wait regardless
          // of when they claimed.
          const lastAt = existing.verifiedAt ?? existing.submittedAt;
          if (lastAt && isWithin24h(lastAt)) {
            const msLeft = msUntil24hExpires(lastAt);
            const hoursLeft = Math.max(1, Math.ceil(msLeft / (60 * 60 * 1000)));
            throw new BadRequestException(
              `Already completed — try again in ~${hoursLeft}h.`,
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
          if (isSendToExternalDailyTask) {
            const result = await this.verifySendToExternalDaily({
              userId,
              userPartyId,
              requiredCount: this.parseSendTransactionRequired(task.target),
            });
            if (!result.ok) {
              throw new BadRequestException(result.message);
            }
          }
          if (isLockCcDailyTask) {
            const result = await this.verifyLockCcDaily({
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
          return {
            status: SubmissionStatus.VERIFIED,
            alreadyDone: false,
            ...(repeatable24h && {
              nextCheckInAt: new Date(
                now.getTime() + 24 * 60 * 60 * 1000,
              ).toISOString(),
            }),
          };
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
    if (isSendToExternalDailyTask) {
      const result = await this.verifySendToExternalDaily({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'sent_to_external';
    }
    if (isLockCcDailyTask) {
      const result = await this.verifyLockCcDaily({
        userId,
        userPartyId,
        requiredCount: this.parseSendTransactionRequired(task.target),
      });
      if (!result.ok) {
        throw new BadRequestException(result.message);
      }
      proof = 'locked_cc_daily';
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

    this.logger.log(
      `Task submitted: user=${userId.slice(0, 8)} quest=${questId} task=${taskId} auto=${String(autoVerify)}`,
    );

    return {
      status: submission.status,
      alreadyDone: false,
      ...(repeatable24h &&
        submission.status === SubmissionStatus.VERIFIED && {
          nextCheckInAt: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        }),
    };
  }

  /* ─── Quest completion (after all tasks verified) ─── */
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
    ledger: QuestLedgerSubmitResult;
  }> {
    const { userId, questId } = params;

    // ── v30 FCFS — HARUS di atas early-return "already submitted": ──────
    // re-submit pengguna yang slot-nya sempat hilang (mis. disapu sweeper
    // pra-fix) harus tetap diamankan ulang + offer dibuat ulang. submitV30Fcfs
    // sendiri idempoten (upsert completion, P2002-tolerant).
    {
      const v30quest = await this.prisma.quest.findUnique({
        where: { id: questId },
        select: {
          id: true,
          rewardCc: true,
          rewardToken: true,
          rewardType: true,
          maxWinners: true,
          startsAt: true,
          endsAt: true,
          entryGateMode: true,
          ledgerPackage: true,
        },
      });
      if (v30quest && isV30Quest(v30quest)) {
        const model = v30ClaimModel(v30quest);
        if (model.selection === 'FCFS') {
          return this.submitV30Fcfs(userId, v30quest);
        }
        // RAFFLE: eligibility WAJIB per-event — lock campaign lain tidak berlaku
        // (spesifikasi owner: 1 event 1 lock; CampaignEligibilityLedger per quest).
        if (model.requiresLock) {
          const eligible = await this.prisma.campaignEligibilityLedger.findFirst({
            where: { questId, userId, status: 'ELIGIBLE' },
            select: { id: true },
          });
          if (!eligible) {
            return {
              ok: false,
              message: 'Lock CC for THIS event first — locks from other events don\'t count.',
              rewardCc: 0,
              inviteCode: null,
              rewardStatus: await this.getQuestRewardStatus(userId, questId),
              ledger: this.emptyLedgerResult(),
            };
          }
        }
      }
    }

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

    // Ledger completion record dinonaktifkan (poin off-chain sejak v21).
    const ledgerResult: QuestLedgerSubmitResult = this.emptyLedgerResult();

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

  /**
   * v30 FCFS submit (spesifikasi owner): slot diamankan saat submit.
   * Urutan: guard waktu → eligibility (lock CC bila gate) → kuota →
   * WinnerDraw (race-safe via unique constraint) → QuestCompletion.
   * Tidak ada offer on-chain di sini — dibuat sweep job saat event berakhir.
   */
  private async submitV30Fcfs(
    userId: string,
    quest: { id: string; rewardCc: number; rewardToken: string; rewardType: string; maxWinners: number | null; startsAt: Date | null; endsAt: Date | null; entryGateMode: string | null },
  ) {
    const fail = async (message: string) => ({
      ok: false,
      message,
      rewardCc: 0,
      inviteCode: null as string | null,
      rewardStatus: await this.getQuestRewardStatus(userId, quest.id),
      ledger: this.emptyLedgerResult(),
    });

    const now = new Date();
    if (quest.startsAt && quest.startsAt > now) return await fail('Quest has not started yet');
    if (quest.endsAt && quest.endsAt < now) return await fail('Quest has ended');

    // Celah bypass: cabang v30 di atas early-return melewati pemeriksaan
    // tugas jalur umum — wajib cek di sini juga (tidak ada slot tanpa tugas).
    const allDone = await this.areAllTasksVerified(userId, quest.id);
    if (!allDone) return await fail('Complete all tasks before submitting');

    const model = v30ClaimModel(quest);

    // Gate lock CC → harus eligible SEBELUM slot diamankan.
    if (model.requiresLock) {
      const eligible = await this.prisma.campaignEligibilityLedger.findFirst({
        where: { questId: quest.id, userId, status: 'ELIGIBLE' },
        select: { id: true },
      });
      if (!eligible) {
        return await fail('Lock CC first to join this campaign (not eligible yet).');
      }
    }

    // Kuota FCFS.
    const drawn = await this.prisma.winnerDraw.count({ where: { questId: quest.id } });
    if (quest.maxWinners != null && drawn >= quest.maxWinners) {
      return await fail('FCFS slots are full — all winners already secured.');
    }

    // Slot — race antar dua submit paralel diselesaikan unique constraint.
    let slotCreated = true;
    try {
      await this.prisma.winnerDraw.create({
        data: {
          questId: quest.id,
          userId,
          // 6 kombinasi: TOKEN_AND_CODE membawa ccAmount penuh + kode;
          // CODE murni tanpa CC; TOKEN tanpa kode.
          ccAmount: model.reward === 'CODE' ? 0 : quest.rewardCc || 0,
          rewardToken: quest.rewardToken,
          rewardVariant:
            model.reward === 'CODE' ? 'CODE' : model.reward === 'TOKEN_AND_CODE' ? null : 'CC',
          fcfsClaimLockedAt: now,
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        // Submit ganda dari user yang sama — slot sudah aman, lanjut.
        slotCreated = false;
      } else {
        throw err;
      }
    }

    // Completion idempoten (re-submit tidak boleh 500 oleh unique constraint).
    await this.prisma.questCompletion.upsert({
      where: { userId_questId: { userId, questId: quest.id } },
      create: {
        userId,
        questId: quest.id,
        rewardMicroCc: BigInt(Math.round((quest.rewardCc || 0) * 1_000_000)),
      },
      update: {},
    });

    // ── Spesifikasi owner (klarifikasi 2026-09-03): FCFS = siapa cepat dapat,
    // TANPA menunggu event berakhir ── slot aman → ClaimOffer LANGSUNG dibuat
    // → tombol claim muncul detik itu juga. Kegagalan buat offer tidak gagalkan
    // slot (sweep T2/backoff mencoba ulang); user tetap bisa muat ulang.
    let offerError: string | null = null;
    try {
      const made = await this.claimOffers.createOfferForWinner(quest.id, userId);
      if (!made.ok && made.skipped !== 'exists') {
        offerError = made.error ?? 'offer pending';
        this.logger.warn(
          `v30 FCFS instant offer GAGAL quest=${quest.id.slice(0, 8)}… user=${userId.slice(0, 8)}… — ${offerError} (slot tetap aman; sweep akan retry)`,
        );
      }
    } catch (err) {
      offerError = String(err).slice(0, 120);
      this.logger.warn(`v30 FCFS instant offer ERROR: ${offerError}`);
    }

    // Kuota penuh → EVENT SELESAI (spesifikasi owner: "kalau FCFS habis maka
    // event selesai"). Status ENDED; unlock peserta tetap di T2 (expiresAt
    // tertanam on-chain — panduan: buat FCFS berdurasi 1–2 hari).
    if (slotCreated && quest.maxWinners != null) {
      const taken = await this.prisma.winnerDraw.count({ where: { questId: quest.id } });
      if (taken >= quest.maxWinners) {
        await this.prisma.quest
          .update({ where: { id: quest.id }, data: { status: 'ENDED' } })
          .catch(() => undefined);
        this.logger.log(
          `v30 FCFS quest=${quest.id.slice(0, 8)}… kuota penuh (${taken}/${quest.maxWinners}) → ENDED`,
        );
      }
    }

    return {
      ok: true,
      message: offerError
        ? 'FCFS slot secured — claim is being prepared, refresh in a moment.'
        : 'FCFS slot secured — you can claim your reward now!',
      rewardCc: quest.rewardCc || 0,
      inviteCode: null,
      rewardStatus: await this.getQuestRewardStatus(userId, quest.id),
      ledger: this.emptyLedgerResult(),
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
    const drawRow = await this.prisma.winnerDraw.findUnique({
      where: { questId_userId: { questId, userId } },
    });
    // v30 ANTI-LEAK: kode plaintext di WinnerDraw hanya untuk hash offer +
    // RevealCode pasca-klaim. Sebelum claimStatus 'Revealed', kode TIDAK
    // boleh keluar dari API apa pun (user bisa pakai kode tanpa bayar fee).
    // Mask di SATU titik ini — seluruh cabang di bawah otomatis aman.
    const draw =
      drawRow && isV30Quest(quest) && drawRow.claimStatus !== 'Revealed'
        ? { ...drawRow, inviteCode: null }
        : drawRow;

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
      if (draw) {
        // Winner tanpa kode ter-assign (fee tidak aktif + pool kosong saat draw).
        // Jangan biarkan pemenang jatuh ke cabang "not_winner" di bawah.
        return {
          state: 'winner' as const,
          inviteCode: null,
          message:
            'You won! Your code is being assigned — contact support if it does not appear.',
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
            (variant === 'CODE'
              ? `Congratulations! Your invite code: ${draw.inviteCode}`
              : `Congratulations! You received ${quest.rewardCc} CC and code: ${draw.inviteCode}`),
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
  /**
   * M3b: siapkan fee leg klaim untuk user EXTERNAL — ditandatangani di
   * browser via signing relay. Berlaku SEMUA tipe campaign (FCFS, draw-cc,
   * invite berbayar, cc+code raffle). Precheck per tipe supaya user tidak
   * menandatangani fee untuk klaim yang pasti ditolak.
   *
   * Alur frontend: prepare-external (endpoint) → signRelayPrepared →
   * claim-* dengan externalFeeTxId.
   */
  async prepareExternalClaimFee(
    userId: string,
    questId: string,
    claimType: 'fcfs' | 'draw_cc' | 'invite' | 'cc_code_raffle',
  ): Promise<{
    flow: string;
    hash: string;
    commandId: string;
    description: string;
    feeCc: number;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.username?.trim() || !user.cantonPartyId?.trim()) {
      throw new BadRequestException(
        'Create your Canton wallet before claiming.',
      );
    }
    if (user.walletKind && user.walletKind !== 'external') {
      throw new BadRequestException(
        'Your wallet is still custodial — claim directly without signing a fee.',
      );
    }

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) throw new NotFoundException('Quest not found');

    const flowByType: Record<typeof claimType, string> = {
      fcfs: 'quest_claim_fcfs_fee',
      draw_cc: 'quest_claim_draw_cc_fee',
      invite: 'quest_claim_invite_fee',
      cc_code_raffle: 'quest_claim_cc_code_raffle_fee',
    };
    const flow = flowByType[claimType];

    // ── Precheck per tipe (mirror guard awal tiap method claim) ──────────
    let feeCc: number;
    if (claimType === 'fcfs') {
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
        throw new BadRequestException(
          'Complete all missions before claiming.',
        );
      }
      feeCc = resolveClaimFeeCc(quest) ?? 3;
    } else if (claimType === 'draw_cc' || claimType === 'cc_code_raffle') {
      if (
        claimType === 'draw_cc' && !this.requiresDrawCcClaim(quest)
      ) {
        throw new BadRequestException(
          'This campaign does not use raffle CC claim.',
        );
      }
      if (
        claimType === 'cc_code_raffle' &&
        !this.requiresCcAndCodeRaffleClaim(quest)
      ) {
        throw new BadRequestException(
          'This campaign does not use CC + code raffle claim.',
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
        throw new BadRequestException('You already claimed this reward.');
      }
      feeCc = resolveClaimFeeCc(quest) ?? 3;
    } else {
      // invite berbayar
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
        throw new BadRequestException('Code already claimed.');
      }
      feeCc = resolveClaimFeeCc(quest) ?? 2;
    }

    if (feeCc <= 0) {
      throw new BadRequestException(
        'This campaign has no claim fee — claim directly without signing.',
      );
    }

    const validatorPartyId = this.config
      .get<string>('CANTON_VALIDATOR_PARTY_ID')
      ?.trim();
    const feeTarget = this.feeTargetPartyId ?? validatorPartyId;
    if (!feeTarget) {
      throw new BadRequestException('Fee target party is not configured.');
    }

    const [senderOnChain, feeOnChain] = await Promise.all([
      this.splice.resolveOnChainPartyId(user.cantonPartyId),
      this.splice.resolveOnChainPartyId(feeTarget),
    ]);

    const built = await this.cantonLedger.buildCip56TransferCommand({
      senderPartyId: senderOnChain,
      receiverPartyId: feeOnChain,
      amountCc: feeCc,
      description: `Claim fee (${claimType}): ${quest.title}`,
    });
    if (!built.ok) throw new BadRequestException(built.error);

    const prepared = await this.signRelay.prepareWithCommands(
      userId,
      flow,
      [built.command],
      {
        disclosedContracts: built.disclosedContracts,
        meta: { questId, feeCc, claimType },
        description: `Claim fee ${feeCc} CC — ${quest.title}`,
        partyId: user.cantonPartyId,
      },
    );
    return { ...prepared, feeCc };
  }

  /** Kompatibilitas: endpoint prepare-external FCFS lama. */
  prepareExternalFcfsClaimFee(userId: string, questId: string) {
    return this.prepareExternalClaimFee(userId, questId, 'fcfs');
  }

  async claimFcfsReward(params: {
    userId: string;
    username: string | null;
    cantonPartyId: string | null;
    questId: string;
    /** M3b: model custody — 'external' memaksa jalur fallback + fee via relay. */
    walletKind?: string | null;
    /** M3b: updateId fee yang sudah di-sign user external (flow quest_claim_fcfs_fee). */
    externalFeeTxId?: string;
  }): Promise<{
    ok: boolean;
    message: string;
    rewardCc: number;
    feeCc: number;
    remainingSlots: number;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
    /** direct = reward langsung masuk wallet (preapproval aktif); pending_offer = user harus accept di wallet. */
    rewardDelivery?: 'direct' | 'pending_offer';
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
    const rewardToken = normalizeRewardToken(quest.rewardToken);
    const maxWinners = quest.maxWinners ?? 0;
    // Reward delivery kind (direct vs pending_offer) — di-set saat helper kirim reward.
    let rewardDeliveryKind: 'direct' | 'pending_offer' | undefined;

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
    const rewardPartyId = this.rewardPartyId; // v24: reward wallet party (co-controller Settle)
    if (!rewardPartyId) {
      throw new Error(
        'CANTON_REWARD_PARTY_ID not configured (required for v24 atomic Settle)',
      );
    }
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
      // v29 anti-slot-burn: retry klaim (Settle gagal sebelumnya) yang SUDAH
      // punya receipt PRE_SETTLE langsung pakai receipt lama — jangan exercise
      // ClaimSlot lagi (tiap exercise mengonsumsi 1 slot kuota + receipt ganda;
      // tanpa contract keys, ledger tidak mendedupe claimId yang sama).
      if (drawNow?.claimSessionContractId) {
        claimSessionId = drawNow.claimSessionContractId;
        this.logger.log(
          `ClaimFcfsSlot reuse receipt (retry settle): claim=${claimSessionId.slice(0, 12)} — skip exercise ClaimSlot`,
        );
      }
      if (this.questLedger.isClaimSessionConfigured() && cantonPartyId) {
        const campaignContractId = (quest as any).ledgerCampaignId ?? null;
        if (campaignContractId && !claimSessionId) {
          // v25: resolve eligibility contract (LOCK_CC / POINTS) utk on-chain guard.
          // v29: return {eligibilityCid, lockCid} — LOCK_CC wajib bawa lockCid.
          let eligibility: {
            eligibilityCid: string | null;
            lockCid: string | null;
          } | null = null;
          try {
            eligibility = await this.resolveEligibilityCid({
              questId,
              userId,
              userPartyId: cantonPartyId,
              eligibilityType: (quest as any).eligibilityType ?? 'NONE',
              eligibilityAmount: (quest as any).eligibilityAmount ?? 0,
              campaignCreatedAt: (quest.createdAt ?? new Date()).toISOString(),
              ledgerPackage: QuestsService.ledgerPackageOf(quest),
            });
          } catch (e) {
            throw new BadRequestException(String(e?.message ?? e));
          }
          const claimResult = await this.questLedger.claimFcfsSlot({
            campaignContractId,
            campaignId: questId, // v29: utk auto-resync cid campaign basi
            userPartyId: cantonPartyId,
            claimId: reservedDrawId,
            rewardSenderPartyId: rewardPartyId, // v24: co-controller Settle
            eligibilityCid: eligibility?.eligibilityCid ?? null, // v25/v29 guard
            lockCid: eligibility?.lockCid ?? null, // v29: CoinLock (LOCK_CC)
            ledgerPackage: QuestsService.ledgerPackageOf(quest),
          });
          claimSessionId = claimResult.claimContractId;
          // v29: ClaimSlot/DrawWinner consuming — persist cid campaign PENERUS.
          await this.refreshLedgerCampaignId(
            questId,
            claimResult.campaignContractId,
          );
          // v29: UseEligibility CONSUMING — eligibility ter-archive saat
          // dipakai. Tandai USED di cache supaya retry tidak reuse cid mati
          // (fetch cid ter-archive => "could not be found" di choice body).
          if (claimResult.claimContractId) {
            await this.markEligibilityUsed(questId, userId);
          }
          // v29 anti-slot-burn: persist receipt SEKARANG — bila Settle gagal lalu
          // user retry, klaim reuse receipt tanpa exercise ClaimSlot lagi.
          if (claimSessionId) {
            await this.prisma.winnerDraw
              .update({
                where: { id: reservedDrawId },
                data: { claimSessionContractId: claimSessionId },
              })
              .catch((err) =>
                this.logger.warn(
                  `persist claimSessionContractId fail: ${String(err)}`,
                ),
              );
          }
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

      // ── BRANCH: atomic Settle vs fallback (non-atomic) ──────────────────────
      // Atomic: fee+reward transfer terjadi DI DALAM Settle choice (1 tx tree).
      //   Tidak boleh collectClaimFee/sendReward terpisah (akan double-transfer).
      // Fallback: collectClaimFee + sendReward terpisah (non-atomic, path v21).
      // v29: reward non-CC (USDCx) TIDAK bisa naik Settle — kontrak mem-pin fee
      // DAN reward ke instrumen Amulet → quest token langsung jalur fallback
      // (fee terpisah + delivery token, jalur produktif lama), bukan gagal
      // di Settle lalu jatuh ke fallback dengan receipt nyangkut PRE_SETTLE.
      if (this.useAtomicSettle &&
        claimSessionId &&
        rewardToken === 'CC' &&
        params.walletKind !== 'external') {
        // ATOMIC PATH (DAML v22/v23 Settle)
        const { updateId } = await this.settleAndRecord({
          drawId: reservedDrawId,
          userId,
          questId,
          questTitle: quest.title,
          cantonPartyId,
          username,
          claimContractId: claimSessionId,
          feeAmount: feeCc,
          rewardAmount: rewardCc,
          rewardToken,
          rewardLabel: 'FCFS reward',
        });
        rewardDeliveryKind = 'direct';
        // claimFeeLedgerTxId = updateId (atomic, fee+reward 1 tx)
        await this.prisma.winnerDraw.update({
          where: { id: reservedDrawId },
          data: {
            ccAmount: rewardCc,
            claimFeeLedgerTxId: updateId,
            claimSessionContractId: claimSessionId,
          },
        });
      } else {
        // FALLBACK PATH (non-atomic, v21-style: collectClaimFee + sendReward terpisah)
        // M3b: user EXTERNAL — fee HARUS sudah dibayar via sign relay (browser);
        // collectClaimFee custodial mustahil utk party external (M0-proof).
        let feeTxId: string | undefined;
        if (drawNow?.claimFeeLedgerTxId) {
          feeTxId = drawNow.claimFeeLedgerTxId;
        } else if (params.walletKind === 'external') {
          if (feeCc > 0 && !params.externalFeeTxId) {
            throw new BadRequestException(
              'Sign the claim fee in your wallet first (non-custodial flow).',
            );
          }
          feeTxId = params.externalFeeTxId;
          if (feeTxId) {
            this.logger.log(
              `FCFS external fee (user-signed): user=${userId.slice(0, 8)} quest=${questId.slice(0, 8)} feeTx=${feeTxId.slice(0, 16)}…`,
            );
          }
        } else {
          feeTxId = await this.collectClaimFee({
            userId,
            cantonPartyId,
            username,
            questTitle: quest.title,
            feeCc,
            feeLabel: 'FCFS claim fee',
            feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
          });
        }

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

        // Step 2: reward wallet (canquest-reward) sends reward → same user party.
        await this.assertRewardPool(rewardCc, rewardToken);

        const { pending: rewardPending } = await this.sendQuestRewardAndRecord({
          drawId: reservedDrawId,
          userId,
          questId,
          questTitle: quest.title,
          cantonPartyId,
          username,
          rewardCc,
          rewardToken,
          claimSessionId,
          feeTxId: feeTxId ?? '',
          rewardLabel: 'FCFS reward',
        });
        rewardDeliveryKind = rewardPending ? 'pending_offer' : 'direct';

        await this.prisma.winnerDraw.update({
          where: { id: reservedDrawId },
          data: {
            ccAmount: rewardCc,
            ...(claimSessionId
              ? { claimSessionContractId: claimSessionId }
              : {}),
          },
        });
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
      rewardDelivery: rewardDeliveryKind,
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
    /** M3b: model custody — 'external' memaksa fallback + fee via relay. */
    walletKind?: string | null;
    /** M3b: updateId fee yang sudah di-sign user external. */
    externalFeeTxId?: string;
  }): Promise<{
    ok: boolean;
    message: string;
    rewardCc: number;
    feeCc: number;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
    rewardDelivery?: 'direct' | 'pending_offer';
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
      // v29 anti-slot-burn: retry yang sudah punya receipt PRE_SETTLE pakai
      // ulang receipt — jangan exercise DrawWinner lagi (kuota + receipt ganda).
      if (drawNow?.claimSessionContractId) {
        claimSessionId = drawNow.claimSessionContractId;
        this.logger.log(
          `DrawRaffleWinner reuse receipt (retry settle): claim=${claimSessionId.slice(0, 12)} — skip exercise DrawWinner`,
        );
      }
      if (this.questLedger.isClaimSessionConfigured() && cantonPartyId) {
        const campaignContractId = (quest as any).ledgerCampaignId ?? null;
        if (campaignContractId && !claimSessionId) {
          // v25: resolve eligibility contract utk on-chain guard.
          // v29: return {eligibilityCid, lockCid} — LOCK_CC wajib bawa lockCid.
          let eligibility: {
            eligibilityCid: string | null;
            lockCid: string | null;
          } | null = null;
          try {
            eligibility = await this.resolveEligibilityCid({
              questId,
              userId,
              userPartyId: cantonPartyId,
              eligibilityType: (quest as any).eligibilityType ?? 'NONE',
              eligibilityAmount: (quest as any).eligibilityAmount ?? 0,
              campaignCreatedAt: (quest.createdAt ?? new Date()).toISOString(),
              ledgerPackage: QuestsService.ledgerPackageOf(quest),
            });
          } catch (e) {
            throw new BadRequestException(String(e?.message ?? e));
          }
          const claimResult = await this.questLedger.drawRaffleWinner({
            campaignContractId,
            campaignId: questId, // v29: utk auto-resync cid campaign basi
            userPartyId: cantonPartyId,
            claimId: draw.id,
            rewardSenderPartyId: this.requireRewardPartyId(), // v24: co-controller Settle
            eligibilityCid: eligibility?.eligibilityCid ?? null, // v25/v29 guard
            lockCid: eligibility?.lockCid ?? null, // v29: CoinLock (LOCK_CC)
            ledgerPackage: QuestsService.ledgerPackageOf(quest),
          });
          claimSessionId = claimResult.claimContractId;
          // v29: ClaimSlot/DrawWinner consuming — persist cid campaign PENERUS.
          await this.refreshLedgerCampaignId(
            questId,
            claimResult.campaignContractId,
          );
          // v29: UseEligibility CONSUMING — eligibility ter-archive saat
          // dipakai. Tandai USED di cache supaya retry tidak reuse cid mati
          // (fetch cid ter-archive => "could not be found" di choice body).
          if (claimResult.claimContractId) {
            await this.markEligibilityUsed(questId, userId);
          }
          // v29 anti-slot-burn: persist receipt SEKARANG — bila Settle gagal lalu
          // user retry, klaim reuse receipt tanpa exercise ClaimSlot lagi.
          if (claimSessionId) {
            await this.prisma.winnerDraw
              .update({
                where: { id: draw.id },
                data: { claimSessionContractId: claimSessionId },
              })
              .catch((err) =>
                this.logger.warn(
                  `persist claimSessionContractId fail: ${String(err)}`,
                ),
              );
          }
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

      let drawRewardPending = false;
      let drawRewardTxId = '';

      // ── BRANCH: atomic Settle vs fallback (non-atomic) ──────────────────────
      // v29: reward non-CC (USDCx) tidak bisa naik Settle (instrumen dipin
      // Amulet) → langsung jalur fallback delivery token.
      if (
        this.useAtomicSettle &&
        claimSessionId &&
        normalizeRewardToken(quest.rewardToken) === 'CC' &&
        params.walletKind !== 'external'
      ) {
        // ATOMIC PATH (DAML v22/v23 Settle)
        const { updateId } = await this.settleAndRecord({
          drawId: draw.id,
          userId,
          questId,
          questTitle: quest.title,
          cantonPartyId,
          username,
          claimContractId: claimSessionId,
          feeAmount: feeCc,
          rewardAmount: rewardCc,
          rewardToken: normalizeRewardToken(quest.rewardToken),
          rewardLabel: 'Raffle reward',
        });
        drawRewardTxId = updateId ?? '';
        await this.prisma.$transaction([
          this.prisma.winnerDraw.update({
            where: { id: draw.id },
            data: {
              ccAmount: rewardCc,
              claimFeeLedgerTxId: drawRewardTxId,
              claimSessionContractId: claimSessionId,
            },
          }),
          this.prisma.questCompletion.update({
            where: { userId_questId: { userId, questId } },
            data: { completedAt: completion.completedAt },
          }),
        ]);
      } else {
        // FALLBACK PATH (non-atomic, v21-style)
        // ⚠️ SECURITY (C1): Fee idempotency guard.
        // M3b: user EXTERNAL — fee via tanda tangan browser (bukan custodial).
        let feeTxId: string | undefined;
        if (drawNow?.claimFeeLedgerTxId) {
          feeTxId = drawNow.claimFeeLedgerTxId;
        } else if (params.walletKind === 'external') {
          if (feeCc > 0 && !params.externalFeeTxId) {
            throw new BadRequestException(
              'Sign the claim fee in your wallet first (non-custodial flow).',
            );
          }
          feeTxId = params.externalFeeTxId;
        } else {
          feeTxId = await this.collectClaimFee({
            userId,
            cantonPartyId,
            username,
            questTitle: quest.title,
            feeCc,
            feeLabel: 'Raffle claim fee',
            feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
          });
        }

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

        await this.assertRewardPool(
          rewardCc,
          normalizeRewardToken(quest.rewardToken),
        );

        // C1 re-check distributed sebelum sendReward.
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

        const { rewardTxId, pending } = await this.sendQuestRewardAndRecord({
          drawId: draw.id,
          userId,
          questId,
          questTitle: quest.title,
          cantonPartyId,
          username,
          rewardCc,
          rewardToken: normalizeRewardToken(quest.rewardToken),
          claimSessionId,
          feeTxId: feeTxId ?? '',
          rewardLabel: 'Raffle reward',
        });
        drawRewardTxId = rewardTxId;
        drawRewardPending = pending;

        await this.prisma.$transaction([
          this.prisma.winnerDraw.update({
            where: { id: draw.id },
            data: {
              ccAmount: rewardCc,
              ...(claimSessionId
                ? { claimSessionContractId: claimSessionId }
                : {}),
            },
          }),
          this.prisma.questCompletion.update({
            where: { userId_questId: { userId, questId } },
            data: { completedAt: completion.completedAt },
          }),
        ]);
      }

      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      return {
        ok: true,
        message: drawRewardPending
          ? `${rewardCc} ${normalizeRewardToken(quest.rewardToken)} sent — accept in your Wallet inbox.`
          : `${rewardCc} ${normalizeRewardToken(quest.rewardToken)} sent to your wallet.`,
        rewardCc,
        feeCc,
        rewardStatus,
        rewardDelivery: drawRewardPending ? 'pending_offer' : 'direct',
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
    /** M3b: model custody — 'external' memaksa fallback + fee via relay. */
    walletKind?: string | null;
    /** M3b: updateId fee yang sudah di-sign user external. */
    externalFeeTxId?: string;
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

    // v29 FIX: pastikan baris WinnerDraw ADA sebelum kerja on-chain/fee —
    // baris ini dipakai claim lock dan persist claimSessionContractId
    // (anti-slot-burn). Sebelumnya baris baru dibuat di akhir flow: claim
    // paralel bisa lolos tanpa lock, dan retry tidak punya receipt cid
    // untuk di-reuse.
    // v29 dedupe: claimId DETERMINISTIK per (draw|quest,user) — retry memakai
    // claimId sama (idempoten + didedupe DB via WinnerDraw.claimId unique).
    const inviteClaimId =
      existingDraw?.claimId ??
      `code-${existingDraw?.id ?? `${questId}:${userId}`}`;
    const drawRow = await this.prisma.winnerDraw.upsert({
      where: { questId_userId: { questId, userId } },
      create: {
        questId,
        userId,
        ccAmount: quest.rewardCc,
        distributed: false,
        claimId: inviteClaimId,
      },
      update: existingDraw?.claimId ? {} : { claimId: inviteClaimId },
    });

    // v29 FIX: lock per (quest,user) — tanpa ini dua request paralel
    // sama-sama exercise DrawWinner (kuota on-chain terbakar 2x) dan
    // settle fee 2x. Jalur FCFS/CC-draw/CC+Code sudah memakai lock ini.
    const inviteLocked = await this.acquireFcfsOnChainLock({
      drawId: drawRow.id,
      questId,
      userId,
    });
    if (!inviteLocked) {
      throw new BadRequestException(
        'Claim already in progress. Wait a moment before trying again.',
      );
    }

    try {
      // v29 FIX: reserve kode SEKARANG (idempoten). Kode dibutuhkan sebagai
      // rewardCode DrawWinner (guard DAML CODE_RAFFLE menolak None) dan
      // reservasi dini membuat retry memakai kode yang sama, bukan membakar
      // kode baru dari pool. (Di dalam try agar lock selalu terlepas.)
      const reservedCode = await this.reserveInviteCodeIdempotent(
        questId,
        userId,
      );
      if (!reservedCode) {
        throw new BadRequestException('No invite codes available.');
      }

      // ── BRANCH: atomic Settle (fee-only, reward=0) vs fallback ──────────────
      // Atomic: fee transfer di Settle choice (1 transaction tree). Tidak collectClaimFee.
      // Fallback: collectClaimFee terpisah (non-atomic, path v21).
      // M3b: user EXTERNAL selalu fallback — fee via tanda tangan browser.
      let feeTxId: string;
      let inviteSettledCid: string | null = null;
      const useAtomicInvite =
        this.useAtomicSettle && params.walletKind !== 'external';

      if (!useAtomicInvite) {
        // FALLBACK: collectClaimFee terpisah
        if (drawRow.claimFeeLedgerTxId) {
          feeTxId = drawRow.claimFeeLedgerTxId;
        } else if (params.walletKind === 'external') {
          if (feeCc > 0 && !params.externalFeeTxId) {
            throw new BadRequestException(
              'Sign the claim fee in your wallet first (non-custodial flow).',
            );
          }
          feeTxId = params.externalFeeTxId ?? `external-free-${questId}-${userId}`;
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
      } else {
        // ATOMIC: fee akan dikirim di Settle (fee-only, rewardAmount=0).
        // feeTxId placeholder; akan di-update setelah settleAtomic sukses.
        feeTxId = drawRow.claimFeeLedgerTxId ?? '';
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
        rewardType === RewardType.INVITE_CODE_FCFS
          ? 'CODE_FCFS'
          : 'CODE_RAFFLE';

      // v29 anti-slot-burn: retry yang sudah punya receipt PRE_SETTLE pakai
      // ulang receipt — jangan exercise ClaimSlot/DrawWinner lagi (tiap
      // exercise mengonsumsi 1 kuota on-chain).
      let codeClaimSessionId: string | null =
        drawRow.claimSessionContractId ?? null;
      if (codeClaimSessionId) {
        this.logger.log(
          `${codeClaimKind} reuse receipt (retry settle): claim=${codeClaimSessionId.slice(0, 12)} — skip exercise`,
        );
      }
      if (
        this.questLedger.isClaimSessionConfigured() &&
        cantonPartyId &&
        !codeClaimSessionId
      ) {
        const campaignContractId = (quest as any).ledgerCampaignId ?? null;
        if (campaignContractId) {
          const claimId = inviteClaimId;
          try {
            // v25: resolve eligibility contract utk on-chain guard.
            // v29: return {eligibilityCid, lockCid} — LOCK_CC wajib bawa lockCid.
            const eligibility = await this.resolveEligibilityCid({
              questId,
              userId,
              userPartyId: cantonPartyId,
              eligibilityType: (quest as any).eligibilityType ?? 'NONE',
              eligibilityAmount: (quest as any).eligibilityAmount ?? 0,
              campaignCreatedAt: (quest.createdAt ?? new Date()).toISOString(),
              ledgerPackage: QuestsService.ledgerPackageOf(quest),
            });
            const claimResult =
              codeClaimKind === 'CODE_FCFS'
                ? await this.questLedger.claimFcfsSlot({
                    campaignContractId,
                    campaignId: questId, // v29: utk auto-resync cid campaign basi
                    userPartyId: cantonPartyId,
                    claimId,
                    rewardSenderPartyId: this.requireRewardPartyId(), // v24: co-controller Settle
                    eligibilityCid: eligibility?.eligibilityCid ?? null, // v25/v29 guard
                    lockCid: eligibility?.lockCid ?? null, // v29: CoinLock (LOCK_CC)
                    ledgerPackage: QuestsService.ledgerPackageOf(quest),
                  })
                : await this.questLedger.drawRaffleWinner({
                    campaignContractId,
                    campaignId: questId, // v29: utk auto-resync cid campaign basi
                    userPartyId: cantonPartyId,
                    claimId,
                    // v29 FIX: guard DAML CODE_RAFFLE mewajibkan rewardCode Some.
                    // Sebelumnya null → DrawWinner SELALU gagal → receipt null →
                    // atomic fee-only Settle ter-skip → fee TIDAK PERNAH tertagih.
                    rewardCode: reservedCode,
                    rewardSenderPartyId: this.requireRewardPartyId(), // v24: co-controller Settle
                    eligibilityCid: eligibility?.eligibilityCid ?? null, // v25/v29 guard
                    lockCid: eligibility?.lockCid ?? null, // v29: CoinLock (LOCK_CC)
                    ledgerPackage: QuestsService.ledgerPackageOf(quest),
                  });
            codeClaimSessionId = claimResult.claimContractId;
            await this.refreshLedgerCampaignId(
              questId,
              claimResult.campaignContractId,
            );
            // v29: UseEligibility CONSUMING — eligibility ter-archive saat
            // dipakai. Tandai USED di cache supaya retry tidak reuse cid mati
            // (fetch cid ter-archive => "could not be found" di choice body).
            if (claimResult.claimContractId) {
              await this.markEligibilityUsed(questId, userId);
            }
            // v29 anti-slot-burn: persist receipt SEKARANG — bila Settle gagal
            // lalu user retry, klaim reuse receipt tanpa exercise lagi.
            if (codeClaimSessionId) {
              await this.prisma.winnerDraw
                .update({
                  where: { id: drawRow.id },
                  data: { claimSessionContractId: codeClaimSessionId },
                })
                .catch((err) =>
                  this.logger.warn(
                    `persist claimSessionContractId fail: ${String(err)}`,
                  ),
                );
            }
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

      // ── ATOMIC Settle (fee-only, reward=0) utk kode claim ───────────────────
      // DAML v23: reward leg Optional. rewardAmount=0 → reward=None → fee-only
      // atomic Settle. feePaid=True setelah ini, sehingga RevealCode bisa jalan.
      if (useAtomicInvite && codeClaimSessionId) {
        try {
          const settleRes = await this.settleAndRecord({
            drawId: drawRow.id,
            userId,
            questId,
            questTitle: quest.title,
            cantonPartyId,
            username,
            claimContractId: codeClaimSessionId,
            feeAmount: feeCc,
            rewardAmount: 0, // kode claim: no token reward
            rewardToken: 'CC',
            rewardLabel: 'Code claim fee',
          });
          inviteSettledCid = settleRes.settledCid;
          feeTxId = settleRes.updateId ?? feeTxId;
          // persist claimFeeLedgerTxId
          await this.prisma.winnerDraw.updateMany({
            where: { questId, userId, distributed: false },
            data: { claimFeeLedgerTxId: feeTxId },
          });
        } catch (err) {
          throw new BadRequestException(
            this.fcfsClaimErrorMessage(
              err instanceof Error ? err.message : String(err),
            ),
          );
        }
      }

      try {
        // Kode sudah di-reserve idempoten di awal (sebelum fee/ledger).
        const claimedCode = reservedCode;

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
              // v29 dedupe: claimId on-chain yang dipakai ClaimSlot/DrawWinner
              // (deterministik — unik via constraint WinnerDraw.claimId).
              claimId: inviteClaimId,
            },
            update: {
              inviteCode: claimedCode,
              distributed: true,
              claimFeeLedgerTxId: feeTxId,
              claimId: inviteClaimId,
            },
          }),
        ]);

        // v22/v23: RevealCode di DAML — hanya receipt SETTLED yang lolos guard
        // ("Harus SETTLE sebelum reveal kode!"). Fallback path tidak men-settle
        // receipt → skip reveal on-chain; kode tetap tersampaikan via DB/UI.
        if (inviteSettledCid) {
          const revealRes = await this.questLedger.revealRewardCode({
            claimContractId: inviteSettledCid,
            code: claimedCode,
            ledgerPackage: QuestsService.ledgerPackageOf(quest),
          });
          if (!revealRes.ok) {
            this.logger.warn(
              `DAML_AUDIT_TRAIL_FAIL RevealCode ${codeClaimKind} quest=${questId.slice(0, 8)} user=@${username} (non-blocking): ${revealRes.errors.join(' | ')}`,
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
        inviteCode: reservedCode,
        feeCc,
        rewardStatus,
      };
    } finally {
      this.releaseFcfsOnChainLock(questId, userId, drawRow.id);
    }
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
    /** M3b: model custody — 'external' memaksa fallback + fee via relay. */
    walletKind?: string | null;
    /** M3b: updateId fee yang sudah di-sign user external. */
    externalFeeTxId?: string;
  }): Promise<{
    ok: boolean;
    message: string;
    rewardCc: number;
    inviteCode: string | null;
    feeCc: number;
    rewardVariant: 'CODE' | 'CC' | null;
    rewardStatus: Awaited<ReturnType<QuestsService['getQuestRewardStatus']>>;
    rewardDelivery?: 'direct' | 'pending_offer';
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
    // Reserve the code BEFORE any fee/ledger work: a pool shortage must fail
    // fast (previously the fee was charged first, then "no codes" aborted),
    // and the reserved code is passed to DrawWinner (v29 guard requires
    // Some rewardCode for CC_AND_CODE_RAFFLE campaigns). Idempotent — a retry
    // re-uses the row assigned by a previous partial attempt.
    let reservedCode: string | null = null;
    if (variant !== 'CC') {
      reservedCode = await this.reserveInviteCodeIdempotent(questId, userId);
      if (!reservedCode) {
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
      // v29 anti-slot-burn: retry yang sudah punya receipt PRE_SETTLE pakai
      // ulang receipt — jangan exercise DrawWinner lagi (tiap exercise
      // mengonsumsi 1 kuota on-chain; tanpa contract keys ledger tidak
      // mendedupe claimId yang sama). Tanpa ini, retry bertahap membakar
      // kuota sampai "Kuota raffle sudah habis!" memblokir semua pemenang.
      let ccCodeClaimSessionId: string | null =
        drawNow?.claimSessionContractId ?? null;
      if (ccCodeClaimSessionId) {
        this.logger.log(
          `DrawWinner reuse receipt (retry settle): claim=${ccCodeClaimSessionId.slice(0, 12)} — skip exercise DrawWinner`,
        );
      }
      if (
        this.questLedger.isClaimSessionConfigured() &&
        cantonPartyId &&
        ccCodeCampaignCid &&
        !ccCodeClaimSessionId
      ) {
        try {
          // v25: resolve eligibility contract utk on-chain guard.
          // v29: return {eligibilityCid, lockCid} — LOCK_CC wajib bawa lockCid.
          const eligibility = await this.resolveEligibilityCid({
            questId,
            userId,
            userPartyId: cantonPartyId,
            eligibilityType: (quest as any).eligibilityType ?? 'NONE',
            eligibilityAmount: (quest as any).eligibilityAmount ?? 0,
            campaignCreatedAt: (quest.createdAt ?? new Date()).toISOString(),
            ledgerPackage: QuestsService.ledgerPackageOf(quest),
          });
          const claimResult = await this.questLedger.drawRaffleWinner({
            campaignContractId: ccCodeCampaignCid,
            campaignId: questId, // v29: utk auto-resync cid campaign basi
            userPartyId: cantonPartyId,
            claimId: draw.id,
            // v29 FIX: guard DAML mewajibkan rewardCode Some untuk
            // CC_AND_CODE_RAFFLE. Sebelumnya null → DrawWinner SELALU gagal
            // ("Quest kode wajib sertakan rewardCode!") → tidak ada receipt,
            // tidak bisa atomic Settle. Varian CC tidak menerima kode →
            // sentinel (SecretRewardCode tidak pernah di-reveal).
            rewardCode:
              variant === 'CC'
                ? 'cc-only-variant'
                : (reservedCode ?? undefined),
            rewardSenderPartyId: this.requireRewardPartyId(), // v24: co-controller Settle
            eligibilityCid: eligibility?.eligibilityCid ?? null, // v25/v29 guard
            lockCid: eligibility?.lockCid ?? null, // v29: CoinLock (LOCK_CC)
            ledgerPackage: QuestsService.ledgerPackageOf(quest),
          });
          ccCodeClaimSessionId = claimResult.claimContractId;
          await this.refreshLedgerCampaignId(
            questId,
            claimResult.campaignContractId,
          );
          // v29: UseEligibility CONSUMING — eligibility ter-archive saat
          // dipakai. Tandai USED di cache supaya retry tidak reuse cid mati
          // (fetch cid ter-archive => "could not be found" di choice body).
          if (claimResult.claimContractId) {
            await this.markEligibilityUsed(questId, userId);
          }
          // v29 anti-slot-burn: persist receipt SEKARANG — bila Settle gagal
          // lalu user retry, klaim reuse receipt tanpa exercise DrawWinner.
          if (ccCodeClaimSessionId) {
            await this.prisma.winnerDraw
              .update({
                where: { id: draw.id },
                data: { claimSessionContractId: ccCodeClaimSessionId },
              })
              .catch((err) =>
                this.logger.warn(
                  `persist claimSessionContractId fail: ${String(err)}`,
                ),
              );
          }
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

      // ── BRANCH: atomic Settle vs fallback (non-atomic) ──────────────────────
      // Atomic: reward CC/USDCx + fee dalam 1 transaction tree.
      //   ccCodeClaimSessionId wajib (DrawWinner sudah jalan sebelumnya).
      // Fallback: collectClaimFee + sendReward terpisah (non-atomic, path v21).
      let rewardOfferId: string | null = null;
      let raffleRewardPending = false;
      let feeTxId: string;
      let settledCid: string | null = null;

      // v29: reward non-CC (USDCx) TIDAK bisa naik Settle — kontrak mem-pin fee
      // DAN reward ke instrumen Amulet → quest token langsung jalur fallback
      // (fee terpisah + delivery token), bukan gagal di Settle dengan receipt
      // nyangkut PRE_SETTLE. (claimDrawCcClaim/FCFS sudah punya cek ini.)
      if (
        this.useAtomicSettle &&
        ccCodeClaimSessionId &&
        params.walletKind !== 'external' &&
        rewardCc > 0 &&
        normalizeRewardToken(quest.rewardToken) === 'CC'
      ) {
        // ATOMIC PATH (DAML v22/v23 Settle)
        await this.assertRewardPool(
          rewardCc,
          normalizeRewardToken(quest.rewardToken),
        );
        const settleRes = await this.settleAndRecord({
          drawId: draw.id,
          userId,
          questId,
          questTitle: quest.title,
          cantonPartyId,
          username,
          claimContractId: ccCodeClaimSessionId,
          feeAmount: feeCc,
          rewardAmount: rewardCc,
          rewardToken: normalizeRewardToken(quest.rewardToken),
          rewardLabel: 'CC+Code raffle reward',
        });
        rewardOfferId = settleRes.updateId;
        settledCid = settleRes.settledCid;
        feeTxId = rewardOfferId ?? `fee-${Date.now()}-${userId.slice(0, 8)}`;
      } else {
        // FALLBACK PATH (non-atomic, v21-style)
        // ⚠️ SECURITY (C1): Fee idempotency guard.
        // M3b: user EXTERNAL — fee via tanda tangan browser (bukan custodial).
        if (drawNow?.claimFeeLedgerTxId) {
          feeTxId = drawNow.claimFeeLedgerTxId;
        } else if (params.walletKind === 'external') {
          if (feeCc > 0 && !params.externalFeeTxId) {
            throw new BadRequestException(
              'Sign the claim fee in your wallet first (non-custodial flow).',
            );
          }
          feeTxId =
            params.externalFeeTxId ??
            `external-free-${questId}-${userId.slice(0, 8)}`;
        } else {
          feeTxId = await this.collectClaimFee({
            userId,
            cantonPartyId,
            username,
            questTitle: quest.title,
            feeCc,
            feeLabel: 'CC+Code raffle claim fee',
            feeTargetPartyId: this.feeTargetPartyId ?? validatorPartyId,
          });
        }

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

        await this.assertRewardPool(
          rewardCc,
          normalizeRewardToken(quest.rewardToken),
        );
        if (rewardCc > 0) {
          // C1 re-check distributed sebelum sendReward.
          const drawPreSend = await this.prisma.winnerDraw.findUnique({
            where: { id: draw.id },
            select: { distributed: true, ledgerTxId: true },
          });
          if (drawPreSend?.distributed) {
            const rewardStatus = await this.getQuestRewardStatus(
              userId,
              questId,
            );
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

          const raffleResult = await this.sendQuestRewardAndRecord({
            drawId: draw.id,
            userId,
            questId,
            questTitle: quest.title,
            cantonPartyId,
            username,
            rewardCc,
            rewardToken: normalizeRewardToken(quest.rewardToken),
            claimSessionId: ccCodeClaimSessionId,
            feeTxId,
            rewardLabel: 'CC+Code raffle reward',
          });
          rewardOfferId = raffleResult.rewardTxId;
          raffleRewardPending = raffleResult.pending;
        }
      }
      // Kode sudah di-reserve idempotent di awal (sebelum fee/ledger) — pakai
      // hasilnya. Varian CC tidak menerima kode (reservedCode null).
      const claimedCode: string | null = reservedCode;
      if (variant !== 'CC' && !claimedCode) {
        // Defensive: seharusnya tak terjangkau (fail-fast di atas).
        throw new Error(
          'No invite codes available after fee was paid. Contact support.',
        );
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

      // v22/v23: RevealCode di DAML — hanya receipt SETTLED yang lolos guard
      // ("Harus SETTLE sebelum reveal kode!"). Fallback path (varian CODE /
      // token non-CC) tidak men-settle receipt → skip reveal on-chain; kode
      // tetap tersampaikan via DB/UI.
      if (finalCode && settledCid) {
        const revealRes = await this.questLedger.revealRewardCode({
          claimContractId: settledCid,
          code: finalCode,
          ledgerPackage: QuestsService.ledgerPackageOf(quest),
        });
        if (!revealRes.ok) {
          this.logger.warn(
            `DAML_AUDIT_TRAIL_FAIL RevealCode CC+Code quest=${questId.slice(0, 8)} user=@${username} code=${finalCode.slice(0, 6)}… (non-blocking): ${revealRes.errors.join(' | ')}`,
          );
        }
      }

      const rewardStatus = await this.getQuestRewardStatus(userId, questId);
      const raffleToken = normalizeRewardToken(quest.rewardToken);
      const deliverySuffix = raffleRewardPending
        ? ' — accept in your Wallet inbox.'
        : '.';
      // Pesan akhir menyesuaikan varian: CODE (hanya kode), CC (hanya token), both (legacy).
      const message =
        variant === 'CODE'
          ? `Congratulations! Your invite code is: ${finalCode}`
          : variant === 'CC'
            ? `Congratulations! ${rewardCc} ${raffleToken} sent to your wallet${deliverySuffix}`
            : `Congratulations! ${rewardCc} ${raffleToken} sent to your wallet${deliverySuffix}${finalCode ? ` and your code is: ${finalCode}` : ''}`;
      return {
        ok: true,
        message,
        rewardCc,
        inviteCode: finalCode,
        feeCc,
        rewardVariant: variant,
        rewardStatus,
        rewardDelivery: raffleRewardPending ? 'pending_offer' : 'direct',
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
        amountMicroCc: { gte: QuestsService.MIN_TASK_ACTION_MICRO_CC },
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
  /**
   * Minimum CC value for a daily on-chain task action to count (sends and
   * swaps). Smaller sends/swaps are ignored — anti-farm guard.
   */
  private static readonly MIN_TASK_ACTION_CC = 20;
  private static readonly MIN_TASK_ACTION_MICRO_CC = 20 * 1_000_000;

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
    const today = await this.countRecentUserTokenSends(
      params.userId,
      windowStart,
    );
    if (today < params.requiredCount) {
      return {
        ok: false,
        message: `You have sent ${today}/${params.requiredCount} USDCx transaction(s) today. Send more USDCx to complete this task.`,
      };
    }
    return { ok: true };
  }

  /**
   * Count a user's REAL swaps since `since` whose CC side is at least
   * MIN_TASK_ACTION_CC. Each swap pair contributes exactly one leg in CC:
   *   - CC → token: the SWAP_OUT row (input amount, description "Swap N CC → …")
   *   - token → CC: the SWAP_IN row (output amount, description "Swap received N CC")
   * Count only rows whose description names CC and whose amount clears the min.
   */
  private async countRecentUserSwaps(
    userId: string,
    since: Date,
  ): Promise<number> {
    const rows = await this.prisma.ccTransaction.findMany({
      where: {
        userId,
        type: { in: ['SWAP_OUT', 'SWAP_IN'] },
        status: 'COMPLETED',
        createdAt: { gte: since },
        amountMicroCc: { gte: QuestsService.MIN_TASK_ACTION_MICRO_CC },
      },
      select: { type: true, description: true },
    });
    let count = 0;
    for (const r of rows) {
      // Leg CC = description menuliskan unit CC pada nominalnya.
      const desc = r.description ?? '';
      const namesCc =
        (r.type === 'SWAP_OUT' && desc.includes(' CC ')) ||
        (r.type === 'SWAP_IN' && desc.trimEnd().endsWith(' CC'));
      if (namesCc) count++;
    }
    return count;
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
        message: `You have made ${today}/${params.requiredCount} swap(s) of at least ${QuestsService.MIN_TASK_ACTION_CC} CC today. Swap at least ${QuestsService.MIN_TASK_ACTION_CC} CC to complete this task.`,
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
  private async countSendAnyToday(
    userId: string,
    since: Date,
  ): Promise<number> {
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
          amountMicroCc: { gte: QuestsService.MIN_TASK_ACTION_MICRO_CC },
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
    const candidates = await this.collectTodayOutgoingCounterparties(
      userId,
      since,
    );
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
        message: `You have sent ${count}/${params.requiredCount} send(s) of at least ${QuestsService.MIN_TASK_ACTION_CC} CC to a CanQuest user today. Send at least ${QuestsService.MIN_TASK_ACTION_CC} CC to complete this task.`,
      };
    }
    return { ok: true };
  }

  /**
   * Count today's outgoing sends whose recipient is NOT a registered CanQuest
   * user (an external wallet — e.g. another dapp's user, a CEX deposit
   * address). Mirror of countSendToUserToday using the notCq set.
   */
  private async countSendToExternalToday(
    userId: string,
    since: Date,
  ): Promise<number> {
    const candidates = await this.collectTodayOutgoingCounterparties(
      userId,
      since,
    );
    if (candidates.length === 0) return 0;
    const { notCq } = await this.resolveCanQuestCounterparties(candidates);
    let count = 0;
    for (const raw of candidates) {
      const n = normalizeCantonPartyId(raw);
      if (n && notCq.has(n)) count++;
    }
    return count;
  }

  /** Verify send_to_external_daily: wallet + ≥ requiredCount sends to a NON-CanQuest wallet today. */
  private async verifySendToExternalDaily(params: {
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
    const count = await this.countSendToExternalToday(params.userId, since);
    if (count < params.requiredCount) {
      return {
        ok: false,
        message: `You have sent ${count}/${params.requiredCount} send(s) of at least ${QuestsService.MIN_TASK_ACTION_CC} CC to an external wallet today. Send at least ${QuestsService.MIN_TASK_ACTION_CC} CC to complete this task.`,
      };
    }
    return { ok: true };
  }

  /** Count locks the user CREATED today (lockedAt since 00:00 UTC). */
  private async countLocksCreatedToday(
    userId: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.ccLock.count({
      where: { userId, lockedAt: { gte: since } },
    });
  }

  /**
   * Verify lock_cc_daily: wallet + ≥ requiredCount NEW locks created today
   * (any duration — the short 2m term qualifies). Repeatable every 24h.
   */
  private async verifyLockCcDaily(params: {
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
    const count = await this.countLocksCreatedToday(params.userId, since);
    if (count < params.requiredCount) {
      return {
        ok: false,
        message: `You have created ${count}/${params.requiredCount} lock(s) today. Lock CC from your wallet to complete this task.`,
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
  ): Promise<{
    ccRows: { referenceId: string | null; ledgerTxId: string | null }[];
  }> {
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
    const { ccRows } = await this.collectTodayIncomingCounterparties(
      userId,
      since,
    );
    const candidates: string[] = [];
    for (const r of ccRows) {
      // Skip legacy balance-sync rows with no sender identity.
      if (r.ledgerTxId?.startsWith('inbound-sync:')) continue;
      if (!r.referenceId) continue;
      // Skip self-referential rows (legacy inbound-sync fallback).
      if (ownPartyId && cantonPartyIdsEqual(r.referenceId, ownPartyId))
        continue;
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
        const { ccRows } = await this.collectTodayIncomingCounterparties(
          userId,
          since,
        );
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
      where: {
        questId: params.questId,
        type: 'lock_cc',
        id: { not: params.taskId },
      },
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
          data: {
            proof: 'lock_cascade',
            status: SubmissionStatus.VERIFIED,
            verifiedAt: now,
            submittedAt: now,
          },
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
