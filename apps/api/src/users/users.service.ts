import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  looksLikeQuestId,
  parseQuestIdFromRewardDescription,
} from '../common/quest-reward-labels';
import { CcTransactionType, SubmissionStatus } from '../common/prisma-types';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    return this.prisma.user.findUnique({ where: { email: normalized } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  /** Case-insensitive username lookup (Send CC / party resolve). */
  findByUsernameInsensitive(username: string) {
    return this.prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
    });
  }

  findByPartyId(cantonPartyId: string) {
    return this.prisma.user.findFirst({ where: { cantonPartyId } });
  }

  async create(params: {
    email: string;
    passwordHash: string;
    displayName?: string | null;
    inviteCode?: string;
    emailVerified?: boolean;
  }) {
    return this.prisma.user.create({
      data: {
        email: params.email,
        passwordHash: params.passwordHash,
        displayName: params.displayName ?? null,
        inviteCode: params.inviteCode ?? null,
        emailVerified: params.emailVerified ?? false,
      },
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

  async setPartyId(userId: string, cantonPartyId: string, username?: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { cantonPartyId, ...(username !== undefined ? { username } : {}) },
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
    const [items, total] = await Promise.all([
      this.prisma.ccTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.ccTransaction.count({ where: { userId } }),
    ]);
    const enriched = await this.enrichQuestRewardDescriptions(items);
    const serialized = enriched.map((tx) => ({
      ...tx,
      amountMicroCc: tx.amountMicroCc.toString(),
    }));
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

  /**
   * Align stored earnPoints with verified activity (keeps repeat daily check-ins via Math.max).
   */
  async reconcileEarnPoints(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { earnPoints: true },
    });
    if (!user) return 0;

    const [submissions, completions, spinWins] = await Promise.all([
      this.prisma.questSubmission.findMany({
        where: { userId, status: SubmissionStatus.VERIFIED },
        include: { task: { select: { points: true } } },
      }),
      this.prisma.questCompletion.findMany({
        where: { userId },
        include: { quest: { select: { rewardCc: true } } },
      }),
      this.prisma.spinResult.findMany({
        where: { userId },
        include: { spinItem: { select: { rewardType: true, rewardPoints: true } } },
      }),
    ]);

    let computed = submissions.reduce((sum, sub) => sum + sub.task.points, 0);
    computed += completions.reduce(
      (sum, c) => sum + Math.round(c.quest.rewardCc * 10),
      0,
    );
    computed += spinWins
      .filter((r) => r.spinItem.rewardType === 'points')
      .reduce((sum, r) => sum + (r.spinItem.rewardPoints ?? 0), 0);

    const finalPoints = Math.max(user.earnPoints, computed);
    if (finalPoints !== user.earnPoints) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { earnPoints: finalPoints },
      });
    }
    return finalPoints;
  }
}
