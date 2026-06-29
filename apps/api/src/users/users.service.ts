import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  looksLikeQuestId,
  parseQuestIdFromRewardDescription,
} from '../common/quest-reward-labels';
import {
  CcTransactionType,
  RewardType,
  normalizeRewardType,
} from '../common/prisma-types';
import { PointsService } from './points.service';
import {
  CC_TRANSACTION_HISTORY_WHERE,
  isFeePartyRecipient,
} from './cc-transaction-visibility';
import type { Prisma } from '@prisma/client';

/**
 * CC event types surfaced in the platform notification bell (SPEC-TX-HISTORY-NOTIF B1).
 *
 * Two distinct concepts — kept separate so feed visibility ≠ badge triggers:
 *   - FEED_TX_TYPES:        semua tipe yang TAMPIL di daftar notifikasi (bell).
 *   - BADGE_UNREAD_TX_TYPES: hanya tipe yang MEMICU titik merah (badge unread).
 *
 * Fee TIDAK termasuk keduanya — baris fee tetap disembunyikan via
 * CC_TRANSACTION_HISTORY_WHERE (Part A3), jadi tidak akan pernah muncul.
 */
export const FEED_TX_TYPES: CcTransactionType[] = [
  'QUEST_REWARD',
  'SPIN_REWARD',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'CC_LOCK',
  'CC_UNLOCK',
  'OFFER_REJECTED',
  'OFFER_WITHDRAWN',
  'PREAPPROVAL_ENABLED',
  'PREAPPROVAL_DISABLED',
];

/**
 * Tipe yang memicu badge unread (titik merah). B2 OPSI 2 (sesuai permintaan pemilik
 * proyek) = SEMUA tipe feed. Konstanta terpusat agar mudah diganti ke OPSI 1
 * (hanya hal yang TERJADI pada user: reward/in/unlock) bila terasa mengganggu:
 *   OPSI 1: ['QUEST_REWARD', 'SPIN_REWARD', 'TRANSFER_IN', 'CC_UNLOCK']
 */
export const BADGE_UNREAD_TX_TYPES: CcTransactionType[] = [
  'QUEST_REWARD',
  'SPIN_REWARD',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'CC_LOCK',
  'CC_UNLOCK',
  'OFFER_REJECTED',
  'OFFER_WITHDRAWN',
  'PREAPPROVAL_ENABLED',
  'PREAPPROVAL_DISABLED',
];

/** @deprecated Use FEED_TX_TYPES (feed) / BADGE_UNREAD_TX_TYPES (badge). */
export const NOTIFICATION_TX_TYPES: CcTransactionType[] = FEED_TX_TYPES;
import {
  looksLikeCantonPartyId,
  normalizeCantonPartyId,
  normalizeWalletUsername,
} from '../common/canton-party-id';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
  ) {}

  findByEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    return this.prisma.user.findUnique({ where: { email: normalized } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByUsername(username: string) {
    const normalized = normalizeWalletUsername(username);
    if (!normalized) return null;
    return this.prisma.user.findUnique({ where: { username: normalized } });
  }

  /** Case-insensitive username lookup (Send CC / party resolve). */
  findByUsernameInsensitive(username: string) {
    return this.prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
    });
  }

  findByPartyId(cantonPartyId: string) {
    const normalized = normalizeCantonPartyId(cantonPartyId);
    if (!normalized) return null;
    return this.prisma.user.findFirst({
      where: { cantonPartyId: { equals: normalized, mode: 'insensitive' } },
    });
  }

  /** Full Canton Party ID for transfer counterparty (resolves @username / legacy short labels). */
  async resolveTransferCounterparty(
    referenceId: string | null,
  ): Promise<string | null> {
    if (!referenceId?.trim()) return null;
    const ref = referenceId.trim();

    if (looksLikeCantonPartyId(ref)) {
      return normalizeCantonPartyId(ref);
    }

    if (
      ref.startsWith('Validator') ||
      ref === 'Canton network' ||
      ref.includes('(reward)') ||
      ref.includes('(FCFS') ||
      ref.includes('(reward pool)')
    ) {
      return ref;
    }

    const username = ref.replace(/^@/, '').toLowerCase();
    const byUser = await this.findByUsernameInsensitive(username);
    if (byUser?.cantonPartyId) {
      return normalizeCantonPartyId(byUser.cantonPartyId);
    }

    const byPrefix = await this.prisma.user.findFirst({
      where: {
        cantonPartyId: { startsWith: `${username}::`, mode: 'insensitive' },
      },
      select: { cantonPartyId: true },
    });
    if (byPrefix?.cantonPartyId) {
      return normalizeCantonPartyId(byPrefix.cantonPartyId);
    }

    return ref;
  }

  async create(params: {
    email: string;
    passwordHash: string;
    displayName?: string | null;
    inviteCode?: string;
    referredById?: string | null;
    referralCode?: string;
    emailVerified?: boolean;
    twitterUsername?: string | null;
    twitterUserId?: string | null;
    twitterAvatarUrl?: string | null;
    twitterConnectedAt?: Date | null;
  }) {
    return this.prisma.user.create({
      data: {
        email: params.email,
        passwordHash: params.passwordHash,
        displayName: params.displayName ?? null,
        inviteCode: params.inviteCode ?? null,
        referredById: params.referredById ?? null,
        referralCode: params.referralCode ?? null,
        emailVerified: params.emailVerified ?? false,
        twitterUsername: params.twitterUsername ?? null,
        twitterUserId: params.twitterUserId ?? null,
        twitterAvatarUrl: params.twitterAvatarUrl ?? null,
        twitterConnectedAt: params.twitterConnectedAt ?? null,
      },
    });
  }

  findByTwitterUsername(username: string) {
    const normalized = username.trim().replace(/^@/, '').toLowerCase();
    return this.prisma.user.findFirst({
      where: { twitterUsername: { equals: normalized, mode: 'insensitive' } },
    });
  }

  setOtpPending(userId: string, otpCodeHash: string, otpExpiresAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      // Reset attempts whenever a fresh code is issued.
      data: { otpCodeHash, otpExpiresAt, otpAttempts: 0 },
    });
  }

  /** Increment the failed-attempt counter for the current pending OTP. */
  incrementOtpAttempts(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { otpAttempts: { increment: 1 } },
    });
  }

  /** Void the pending OTP entirely (used after lockout / verification). */
  clearOtp(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { otpCodeHash: null, otpExpiresAt: null, otpAttempts: 0 },
    });
  }

  async setVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        otpCodeHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });
  }

  updatePasswordHash(
    userId: string,
    passwordHash: string,
    emailVerified = true,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, emailVerified },
    });
  }

  /** Replace credentials for a user who never completed email OTP verification. */
  resumeUnverifiedRegistration(
    userId: string,
    passwordHash: string,
    referredById?: string | null,
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        emailVerified: false,
        otpCodeHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        ...(referredById !== undefined ? { referredById } : {}),
      },
    });
  }

  async setCantonIdentity(
    userId: string,
    params: { partyId: string; keycloakId: string; username?: string },
  ) {
    const normalized =
      normalizeCantonPartyId(params.partyId) ?? params.partyId.trim();
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          cantonPartyId: normalized,
          keycloakId: params.keycloakId,
          username: params.username?.trim() || undefined,
        },
      });
    } catch (err) {
      // SECURITY (H6): cantonPartyId is now @unique. A P2002 means this wallet
      // is already bound to another account — the DB is the source of truth,
      // catching the TOCTOU race that the app-layer findByPartyId check misses.
      if (this.isUniquePartyViolation(err)) {
        throw new ConflictException('Party ID Already Taken');
      }
      throw err;
    }
  }

  async setPartyId(userId: string, cantonPartyId: string, username?: string) {
    const normalized =
      normalizeCantonPartyId(cantonPartyId) ?? cantonPartyId.trim();
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          cantonPartyId: normalized,
          ...(username !== undefined
            ? { username: normalizeWalletUsername(username) }
            : {}),
        },
      });
    } catch (err) {
      // SECURITY (H6): cantonPartyId is now @unique — surface a clear conflict
      // instead of an opaque Prisma error when a wallet is double-bound.
      if (this.isUniquePartyViolation(err)) {
        throw new ConflictException('Party ID Already Taken');
      }
      throw err;
    }
  }

  /**
   * Detect a Prisma unique-constraint violation (P2002) on cantonPartyId.
   * Used by setCantonIdentity/setPartyId to translate the DB-level uniqueness
   * guard (added in H6) into a user-facing ConflictException.
   */
  private isUniquePartyViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { code?: string; meta?: { target?: string[] } };
    if (e.code !== 'P2002') return false;
    const target = e.meta?.target ?? [];
    return (
      target.includes('cantonPartyId') ||
      target.includes('User_cantonPartyId_key')
    );
  }

  /** Record a CC debit or credit in the local DB (audit trail). */
  async recordTransaction(params: {
    userId: string;
    amountCc: number;
    type: CcTransactionType;
    description: string;
    /** questId, earnEntryId, etc. */
    referenceId?: string | null;
    /** Legacy: stored in referenceId when referenceId is omitted (e.g. transfer peer). */
    counterparty?: string;
    ledgerTxId?: string;
    cantonUpdateId?: string;
    /** COMPLETED (default) | PENDING (offer belum di-accept) | REJECTED */
    status?: 'COMPLETED' | 'PENDING' | 'REJECTED';
    /** cid AmuletTransferInstruction untuk reward yang masih pending. */
    transferInstructionCid?: string | null;
  }) {
    const amountMicroCc = BigInt(
      Math.round(Math.abs(params.amountCc) * 1_000_000),
    );
    // Debit (keluar dari saldo yang bisa dipakai): TRANSFER_OUT & CC_LOCK (dana dikunci).
    // Kredit (masuk): TRANSFER_IN, QUEST_REWARD, SPIN_REWARD, AIRDROP, CC_UNLOCK.
    const isDebit = params.type === 'TRANSFER_OUT' || params.type === 'CC_LOCK';
    const signed = isDebit ? -amountMicroCc : amountMicroCc;
    const referenceId =
      params.referenceId !== undefined
        ? params.referenceId
        : (params.counterparty ?? null);
    return this.prisma.ccTransaction.create({
      data: {
        userId: params.userId,
        amountMicroCc: signed,
        type: params.type,
        description: params.description,
        referenceId,
        ledgerTxId: params.ledgerTxId ?? null,
        cantonUpdateId: params.cantonUpdateId ?? null,
        status: params.status ?? 'COMPLETED',
        transferInstructionCid: params.transferInstructionCid ?? null,
        settledAt: params.status === 'PENDING' ? null : new Date(),
      },
    });
  }

  private resolveQuestIdForTransaction(tx: {
    type: CcTransactionType;
    description: string;
    referenceId: string | null;
  }): string | null {
    if (tx.type !== 'QUEST_REWARD') return null;
    if (tx.referenceId && looksLikeQuestId(tx.referenceId))
      return tx.referenceId;
    return parseQuestIdFromRewardDescription(tx.description);
  }

  /** Map quest ids → project titles (quest.title). */
  async getQuestTitlesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const quests = await this.prisma.quest.findMany({
      where: { id: { in: ids } },
      select: { id: true, title: true },
    });
    return new Map(quests.map((q) => [q.id, q.title]));
  }

  /** Show quest project name instead of raw id; backfill legacy rows in DB. */
  private async enrichQuestRewardDescriptions<
    T extends {
      id: string;
      type: CcTransactionType;
      description: string;
      referenceId: string | null;
    },
  >(items: T[]): Promise<T[]> {
    const questIds = new Set<string>();
    for (const tx of items) {
      const qid = this.resolveQuestIdForTransaction(tx);
      if (qid) questIds.add(qid);
    }
    if (questIds.size === 0) return items;

    const titleById = await this.getQuestTitlesByIds([...questIds]);
    const backfill: { id: string; title: string; questId: string }[] = [];

    const enriched = items.map((tx) => {
      if (tx.type !== 'QUEST_REWARD') return tx;
      if (/^Received [\d.]+\sCC reward/.test(tx.description)) {
        const questId = this.resolveQuestIdForTransaction(tx);
        return { ...tx, referenceId: questId ?? tx.referenceId };
      }
      const questId = this.resolveQuestIdForTransaction(tx);
      const title = questId ? titleById.get(questId) : null;
      if (!title) return tx;
      if (tx.description !== title || tx.referenceId !== questId) {
        backfill.push({ id: tx.id, title, questId: questId! });
      }
      return {
        ...tx,
        description: title,
        referenceId: questId ?? tx.referenceId,
      };
    });

    if (backfill.length > 0) {
      void Promise.all(
        backfill.map(({ id, title, questId }) =>
          this.prisma.ccTransaction.update({
            where: { id },
            data: { description: title, referenceId: questId },
          }),
        ),
      ).catch((err) =>
        this.logger.warn(`Quest reward label backfill: ${String(err)}`),
      );
    }

    return enriched;
  }

  /** Where-clause for the FEED list — semua tipe yang tampil di bell (FEED_TX_TYPES). */
  private notificationFeedWhere(
    userId: string,
  ): Prisma.CcTransactionWhereInput {
    return {
      userId,
      type: { in: FEED_TX_TYPES },
      ...CC_TRANSACTION_HISTORY_WHERE,
    };
  }

  /** Where-clause untuk hitung BADGE unread — hanya BADGE_UNREAD_TX_TYPES. */
  private notificationBadgeWhere(
    userId: string,
    lastSeenAt: Date | null,
  ): Prisma.CcTransactionWhereInput {
    const base: Prisma.CcTransactionWhereInput = {
      userId,
      type: { in: BADGE_UNREAD_TX_TYPES },
      ...CC_TRANSACTION_HISTORY_WHERE,
    };
    return lastSeenAt ? { ...base, createdAt: { gt: lastSeenAt } } : base;
  }

  /**
   * Recent CC rewards/transfers + raffle draw results for the notification bell.
   *
   * Fee rows diexclude dua lapis sama seperti getTransactions: filter Prisma
   * (CC_TRANSACTION_HISTORY_WHERE) + post-filter isFeePartyRecipient() berdasarkan
   * party penerima. Post-filter diterapkan ke FEED item DAN badge unread count supaya
   * fee benar-benar hilang dari bell DAN titik merah (sesuai MD note A: badge = semua
   * tipe KECUALI fee).
   */
  async getNotifications(userId: string, limit = 12) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationsLastSeenAt: true },
    });
    const lastSeenAt = user?.notificationsLastSeenAt ?? null;
    const feedWhere = this.notificationFeedWhere(userId);
    const take = Math.min(30, Math.max(1, limit));

    const [feedRows, badgeRows, drawAlerts, codeClaimAlerts] =
      await Promise.all([
        this.prisma.ccTransaction.findMany({
          where: feedWhere,
          orderBy: { createdAt: 'desc' },
          take,
        }),
        // Ambil baris badge (id + referenceId + type) untuk post-filter fee, lalu hitung.
        this.prisma.ccTransaction.findMany({
          where: this.notificationBadgeWhere(userId, lastSeenAt),
          orderBy: { createdAt: 'desc' },
          select: { id: true, referenceId: true, type: true, createdAt: true },
        }),
        this.getDrawAlerts(userId, lastSeenAt),
        this.getCodeClaimAlerts(userId, lastSeenAt),
      ]);

    // Post-filter fee dari FEED (buang penerima = party fee).
    const feeFilteredFeed: typeof feedRows = [];
    for (const tx of feedRows) {
      if (tx.type !== 'TRANSFER_IN' && tx.type !== 'TRANSFER_OUT') {
        feeFilteredFeed.push(tx);
        continue;
      }
      const resolved = await this.resolveTransferCounterparty(tx.referenceId);
      if (!isFeePartyRecipient(tx.referenceId, resolved))
        feeFilteredFeed.push(tx);
    }

    // Post-filter fee dari BADGE unread count.
    let unreadTxCount = 0;
    for (const row of badgeRows) {
      if (row.type !== 'TRANSFER_IN' && row.type !== 'TRANSFER_OUT') {
        unreadTxCount++;
        continue;
      }
      const resolved = await this.resolveTransferCounterparty(row.referenceId);
      if (!isFeePartyRecipient(row.referenceId, resolved)) unreadTxCount++;
    }

    const enriched = await this.enrichQuestRewardDescriptions(feeFilteredFeed);
    const serializedTx = await Promise.all(
      enriched.map(async (tx) => {
        const counterparty =
          tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT'
            ? await this.resolveTransferCounterparty(tx.referenceId)
            : null;
        return {
          kind: 'transaction' as const,
          id: tx.id,
          type: tx.type,
          description: tx.description,
          amountMicroCc: tx.amountMicroCc.toString(),
          referenceId: tx.referenceId,
          counterparty,
          createdAt: tx.createdAt.toISOString(),
        };
      }),
    );

    const merged = [...serializedTx, ...drawAlerts, ...codeClaimAlerts]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, take);

    const unreadDrawCount = drawAlerts.filter((a) => a.unread).length;
    const unreadCodeCount = codeClaimAlerts.filter((a) => a.unread).length;

    return {
      unreadCount: unreadTxCount + unreadDrawCount + unreadCodeCount,
      lastSeenAt: lastSeenAt?.toISOString() ?? null,
      items: merged,
    };
  }

  /** Paid code claims — user paid claim fee and received a code from the pool. */
  private async getCodeClaimAlerts(
    userId: string,
    lastSeenAt: Date | null,
  ): Promise<
    Array<{
      kind: 'code';
      id: string;
      questId: string;
      questTitle: string;
      code: string;
      description: string;
      createdAt: string;
      unread: boolean;
    }>
  > {
    const draws = await this.prisma.winnerDraw.findMany({
      where: {
        userId,
        inviteCode: { not: null },
        claimFeeLedgerTxId: { not: null },
        quest: {
          rewardType: {
            in: ['INVITE_CODE_FCFS', 'INVITE_CODE_RANDOM', 'INVITE_CODE'],
          },
        },
      },
      select: {
        questId: true,
        inviteCode: true,
        drawnAt: true,
        quest: { select: { title: true } },
      },
      orderBy: { drawnAt: 'desc' },
      take: 30,
    });

    return draws
      .map((d) => {
        const createdAt = d.drawnAt.toISOString();
        const unread = !lastSeenAt || d.drawnAt > lastSeenAt;
        const code = (d.inviteCode ?? '').trim();
        if (!code) return null;
        return {
          kind: 'code' as const,
          id: `code-claim-${d.questId}`,
          questId: d.questId,
          questTitle: d.quest.title,
          code,
          description: `You successfully claimed a code for "${d.quest.title}". Your code is ready: ${code}`,
          createdAt,
          unread,
        };
      })
      .filter(Boolean) as Array<{
      kind: 'code';
      id: string;
      questId: string;
      questTitle: string;
      code: string;
      description: string;
      createdAt: string;
      unread: boolean;
    }>;
  }

  /** Raffle draw results — winners/losers notified after admin draw. */
  private isRaffleDrawRewardType(rt: RewardType): boolean {
    return (
      rt === RewardType.CC_MANUAL ||
      rt === RewardType.INVITE_CODE_RANDOM ||
      rt === RewardType.INVITE_CODE ||
      rt === RewardType.WAITLIST_EMAIL ||
      rt === RewardType.CC_AND_CODE_RAFFLE
    );
  }

  private buildDrawAlertDescription(params: {
    rewardType: RewardType;
    questTitle: string;
    rewardCc: number;
    winnerMessage: string | null;
    won: boolean;
    userDraw: { distributed: boolean; inviteCode: string | null } | null;
  }): { description: string; rewardCc: number | null } {
    const { rewardType, questTitle, rewardCc, winnerMessage, won, userDraw } =
      params;
    if (!won) {
      return {
        description: `Not selected for ${questTitle}. Better luck next time.`,
        rewardCc: null,
      };
    }

    if (rewardType === RewardType.CC_MANUAL) {
      return {
        description: userDraw?.distributed
          ? `You won ${rewardCc} CC from ${questTitle}.`
          : `You won ${rewardCc} CC — open the campaign to claim your reward.`,
        rewardCc: rewardCc > 0 ? rewardCc : null,
      };
    }

    if (
      rewardType === RewardType.INVITE_CODE_RANDOM ||
      rewardType === RewardType.INVITE_CODE
    ) {
      if (userDraw?.inviteCode) {
        return {
          description: `You won ${questTitle}. Your code is ready.`,
          rewardCc: null,
        };
      }
      return {
        description: `You won ${questTitle} — open the campaign to claim your code.`,
        rewardCc: null,
      };
    }

    if (rewardType === RewardType.CC_AND_CODE_RAFFLE) {
      const codePart = userDraw?.inviteCode
        ? ` + code: ${userDraw.inviteCode}`
        : '';
      if (userDraw?.distributed) {
        return {
          description: `You won ${questTitle}! ${rewardCc} CC${codePart} sent to your wallet.`,
          rewardCc: rewardCc > 0 ? rewardCc : null,
        };
      }
      return {
        description: `You won ${questTitle}! ${rewardCc} CC${codePart} — claim your reward now.`,
        rewardCc: rewardCc > 0 ? rewardCc : null,
      };
    }

    if (rewardType === RewardType.WAITLIST_EMAIL) {
      const custom = winnerMessage?.trim();
      return {
        description:
          custom ??
          `You were selected for ${questTitle} — open the campaign for next steps.`,
        rewardCc: null,
      };
    }

    return {
      description: `You were selected for ${questTitle}.`,
      rewardCc: null,
    };
  }

  private async getDrawAlerts(
    userId: string,
    lastSeenAt: Date | null,
  ): Promise<
    Array<{
      kind: 'draw';
      id: string;
      drawKind: 'win' | 'loss';
      questId: string;
      questTitle: string;
      rewardCc: number | null;
      description: string;
      createdAt: string;
      unread: boolean;
    }>
  > {
    const completions = await this.prisma.questCompletion.findMany({
      where: { userId },
      select: {
        questId: true,
        quest: {
          select: {
            id: true,
            title: true,
            rewardType: true,
            rewardCc: true,
            winnerMessage: true,
          },
        },
      },
    });

    const alerts: Array<{
      kind: 'draw';
      id: string;
      drawKind: 'win' | 'loss';
      questId: string;
      questTitle: string;
      rewardCc: number | null;
      description: string;
      createdAt: string;
      unread: boolean;
    }> = [];

    for (const c of completions) {
      const rt = normalizeRewardType(c.quest.rewardType);
      if (!this.isRaffleDrawRewardType(rt)) continue;

      const latestDraw = await this.prisma.winnerDraw.findFirst({
        where: { questId: c.questId },
        orderBy: { drawnAt: 'desc' },
      });
      if (!latestDraw) continue;

      const userDraw = await this.prisma.winnerDraw.findUnique({
        where: { questId_userId: { questId: c.questId, userId } },
      });
      const drawnAt = latestDraw.drawnAt;
      const unread = !lastSeenAt || drawnAt > lastSeenAt;
      const won = Boolean(userDraw);
      const { description, rewardCc } = this.buildDrawAlertDescription({
        rewardType: rt,
        questTitle: c.quest.title,
        rewardCc: c.quest.rewardCc,
        winnerMessage: c.quest.winnerMessage,
        won,
        userDraw,
      });

      alerts.push({
        kind: 'draw',
        id: won ? `draw-win-${c.questId}` : `draw-loss-${c.questId}`,
        drawKind: won ? 'win' : 'loss',
        questId: c.questId,
        questTitle: c.quest.title,
        rewardCc,
        description,
        createdAt: drawnAt.toISOString(),
        unread,
      });
    }

    return alerts;
  }

  async markNotificationsSeen(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationsLastSeenAt: new Date() },
    });
    return { ok: true as const };
  }

  /**
   * Paginated transaction list for a user (newest first). BigInt serialized as string.
   *
   * Fee rows diexclude dua lapis: (1) filter Prisma `CC_TRANSACTION_HISTORY_WHERE` berdasarkan
   * marker/deskripsi, lalu (2) post-filter `isFeePartyRecipient()` membuang baris yang
   * penerimanya = party fee (mis. "Sent to canquest-fee…") walau tidak bermarker. Karena
   * post-filter butuh counterparty yang di-resolve (DB), kita hitung id transaksi yang lolos
   * dulu, lalu paginate berdasarkan id agar total/halaman tetap akurat.
   */
  async getTransactions(userId: string, page: number, pageSize: number) {
    const baseWhere = { userId, ...CC_TRANSACTION_HISTORY_WHERE };

    // 1. Ambil id + referenceId + type untuk seluruh history (proyeksi ringan).
    const allRows = await this.prisma.ccTransaction.findMany({
      where: baseWhere,
      orderBy: { createdAt: 'desc' },
      select: { id: true, referenceId: true, type: true, createdAt: true },
    });

    // 2. Post-filter: buang baris yang penerimanya = party fee.
    const visibleIds: string[] = [];
    for (const row of allRows) {
      if (row.type !== 'TRANSFER_IN' && row.type !== 'TRANSFER_OUT') {
        visibleIds.push(row.id);
        continue;
      }
      const resolved = await this.resolveTransferCounterparty(row.referenceId);
      if (!isFeePartyRecipient(row.referenceId, resolved)) {
        visibleIds.push(row.id);
      }
    }

    const total = visibleIds.length;
    const skip = (page - 1) * pageSize;
    const pageIds = visibleIds.slice(skip, skip + pageSize);

    // 3. Ambil baris penuh untuk id halaman ini (urutan createdAt desc dipertahankan).
    const items = pageIds.length
      ? await this.prisma.ccTransaction.findMany({
          where: { id: { in: pageIds } },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const enriched = await this.enrichQuestRewardDescriptions(items);
    const serialized = await Promise.all(
      enriched.map(async (tx) => {
        const counterparty =
          tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT'
            ? await this.resolveTransferCounterparty(tx.referenceId)
            : null;
        return {
          ...tx,
          amountMicroCc: tx.amountMicroCc.toString(),
          counterparty,
        };
      }),
    );
    return {
      items: serialized,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Lifetime points from Quest menu, Earn hub, campaign tasks, completion bonuses, referral. */
  async creditEarnPoints(userId: string, amount: number): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) return;
    await this.prisma.user.update({
      where: { id: userId },
      data: { earnPoints: { increment: Math.round(amount) } },
    });
  }

  /** Saat offer pending di-accept/reject manual, update status tx reward terkait. */
  async markTransferInstructionSettled(
    transferInstructionCid: string,
    status: 'COMPLETED' | 'REJECTED',
  ): Promise<number> {
    // Ambil dulu row PENDING yang cocok supaya bisa bersihkan suffix deskripsi
    // "[pending — recipient must accept offer]" saat offer selesai (accept/reject).
    const pendingRows = await this.prisma.ccTransaction.findMany({
      where: { transferInstructionCid, status: 'PENDING' },
      select: { id: true, description: true },
    });
    if (pendingRows.length === 0) return 0;

    const settledAt = status === 'COMPLETED' ? new Date() : null;
    for (const row of pendingRows) {
      const cleanDesc = row.description
        .replace(/\s*\[pending[^\]]*\]\s*/i, '')
        .trim();
      await this.prisma.ccTransaction.update({
        where: { id: row.id },
        data: {
          status,
          settledAt,
          ...(cleanDesc !== row.description ? { description: cleanDesc } : {}),
        },
      });
    }
    return pendingRows.length;
  }

  /** Catat waktu toggle preapproval (enable/disable) untuk cooldown anti-spam 7 hari. */
  async markPreapprovalToggle(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { preapprovalToggleAt: new Date() },
    });
  }

  /** Align User.earnPoints with quest + earn + referral activity. */
  reconcileEarnPoints(userId: string): Promise<number> {
    return this.points.reconcileUserEarnPoints(userId);
  }

  /**
   * Net spendable points = earnPoints - total earn entry cost spent.
   * Satu-satunya sumber kebenaran untuk semua halaman (dashboard, quest, leaderboard).
   */
  getNetPoints(userId: string): Promise<number> {
    return this.points.getNetPoints(userId);
  }
}
