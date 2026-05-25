import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  looksLikeQuestId,
  parseQuestIdFromRewardDescription,
} from '../common/quest-reward-labels';
import { CcTransactionType } from '../common/prisma-types';
import { PointsService } from './points.service';
import { CC_TRANSACTION_HISTORY_WHERE } from './cc-transaction-visibility';
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
  async resolveTransferCounterparty(referenceId: string | null): Promise<string | null> {
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
      where: { cantonPartyId: { startsWith: `${username}::`, mode: 'insensitive' } },
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
      data: { otpCodeHash, otpExpiresAt },
    });
  }

  async setVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, otpCodeHash: null, otpExpiresAt: null },
    });
  }

  updatePasswordHash(userId: string, passwordHash: string, emailVerified = true) {
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
        ...(referredById !== undefined ? { referredById } : {}),
      },
    });
  }

  async setPartyId(userId: string, cantonPartyId: string, username?: string) {
    const normalized = normalizeCantonPartyId(cantonPartyId) ?? cantonPartyId.trim();
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        cantonPartyId: normalized,
        ...(username !== undefined
          ? { username: normalizeWalletUsername(username) }
          : {}),
      },
    });
  }

  /** Record a CC debit or credit in the local DB (audit trail). */
  async recordTransaction(params: {
    userId: string;
    amountCc: number;
    type: CcTransactionType;
    description: string;
    /** questId, spinId, etc. */
    referenceId?: string | null;
    /** Legacy: stored in referenceId when referenceId is omitted (e.g. transfer peer). */
    counterparty?: string;
    ledgerTxId?: string;
    cantonUpdateId?: string;
  }) {
    const amountMicroCc = BigInt(Math.round(Math.abs(params.amountCc) * 1_000_000));
    const signed =
      params.type === 'TRANSFER_OUT' ? -amountMicroCc : amountMicroCc;
    const referenceId =
      params.referenceId !== undefined
        ? params.referenceId
        : params.counterparty ?? null;
    return this.prisma.ccTransaction.create({
      data: {
        userId: params.userId,
        amountMicroCc: signed,
        type: params.type,
        description: params.description,
        referenceId,
        ledgerTxId: params.ledgerTxId ?? null,
        cantonUpdateId: params.cantonUpdateId ?? null,
        settledAt: new Date(),
      },
    });
  }

  private resolveQuestIdForTransaction(tx: {
    type: CcTransactionType;
    description: string;
    referenceId: string | null;
  }): string | null {
    if (tx.type !== 'QUEST_REWARD') return null;
    if (tx.referenceId && looksLikeQuestId(tx.referenceId)) return tx.referenceId;
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
      const questId = this.resolveQuestIdForTransaction(tx);
      const title = questId ? titleById.get(questId) : null;
      if (!title) return tx;
      if (
        tx.description !== title ||
        tx.referenceId !== questId
      ) {
        backfill.push({ id: tx.id, title, questId: questId! });
      }
      return { ...tx, description: title, referenceId: questId ?? tx.referenceId };
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

  /** Paginated transaction list for a user (newest first). BigInt serialized as string. */
  async getTransactions(userId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const where = { userId, ...CC_TRANSACTION_HISTORY_WHERE };
    const [items, total] = await Promise.all([
      this.prisma.ccTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.ccTransaction.count({ where }),
    ]);
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
    return { items: serialized, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** Lifetime points from Quest menu, Earn hub, campaign tasks, completion bonuses, spin wins. */
  async creditEarnPoints(userId: string, amount: number): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) return;
    await this.prisma.user.update({
      where: { id: userId },
      data: { earnPoints: { increment: Math.round(amount) } },
    });
  }

  /** Align User.earnPoints with quest + earn + spin + referral activity. */
  reconcileEarnPoints(userId: string): Promise<number> {
    return this.points.reconcileUserEarnPoints(userId);
  }
}
