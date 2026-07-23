import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  looksLikeQuestId,
  parseQuestIdFromRewardDescription,
} from '../common/quest-reward-labels';
import {
  CcTransactionType,
  RewardType,
  TOKEN_TX_DEBIT_TYPES,
  TokenTxType,
  normalizeRewardType,
} from '../common/prisma-types';
import { Decimal } from '@prisma/client/runtime/library';
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
  'SWAP_OUT',
  'SWAP_IN',
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
  'SWAP_OUT',
  'SWAP_IN',
];

/** @deprecated Use FEED_TX_TYPES (feed) / BADGE_UNREAD_TX_TYPES (badge). */
export const NOTIFICATION_TX_TYPES: CcTransactionType[] = FEED_TX_TYPES;

/**
 * TokenTransaction types yang tampil di notification bell (feed) dan memicu
 * badge unread. Paralel dengan FEED_TX_TYPES / BADGE_UNREAD_TX_TYPES untuk CC.
 * TOKEN_FEE_OUT TIDAK termasuk (audit-only, disembunyikan).
 */
export const FEED_TOKEN_TX_TYPES: TokenTxType[] = [
  'TOKEN_TRANSFER_IN',
  'TOKEN_TRANSFER_OUT',
  'TOKEN_OFFER_REJECTED',
  'TOKEN_OFFER_WITHDRAWN',
];
export const BADGE_UNREAD_TOKEN_TX_TYPES: TokenTxType[] =
  FEED_TOKEN_TX_TYPES;
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
    private readonly realtime: RealtimeService,
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
    /** Jumlah CC asli yang dibatalkan/ditolak (OFFER_WITHDRAWN / OFFER_REJECTED).
     *  Saldo tidak bergerak (amountCc=0); ini hanya untuk display "cancelled X CC". */
    cancelledAmountCc?: number | null;
    /** Instrument id (mis. "USDCx") bila offer yang dibatalkan adalah token non-CC. */
    cancelledInstrumentId?: string | null;
    /** SILENT: catat history TAPI jangan push transaction:new (anti duplikat
     *  notif badge). Dipakai swap flow — notif swap sudah di-handle WSS handler
     *  (yang lihat delivery on-chain sebagai TRANSFER_IN). Tanpa flag ini, user
     *  dapat 2-3 notif untuk 1 swap (SWAP_IN dari controller + TRANSFER_IN dari
     *  handler + fee transfer). */
    silent?: boolean;
  }) {
    const amountMicroCc = BigInt(
      Math.round(Math.abs(params.amountCc) * 1_000_000),
    );
    // Debit (keluar dari saldo yang bisa dipakai): TRANSFER_OUT, CC_LOCK, SWAP_OUT.
    // Kredit (masuk): TRANSFER_IN, QUEST_REWARD, SPIN_REWARD, AIRDROP, CC_UNLOCK, SWAP_IN.
    const isDebit =
      params.type === 'TRANSFER_OUT' ||
      params.type === 'CC_LOCK' ||
      params.type === 'SWAP_OUT';
    const signed = isDebit ? -amountMicroCc : amountMicroCc;
    const referenceId =
      params.referenceId !== undefined
        ? params.referenceId
        : (params.counterparty ?? null);
    const tx = await this.prisma.ccTransaction.create({
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
        cancelledAmountCc:
          params.cancelledAmountCc != null
            ? new Decimal(Math.abs(Number(params.cancelledAmountCc)))
            : null,
        cancelledInstrumentId: params.cancelledInstrumentId ?? null,
      },
    });

    // ── Realtime push ────────────────────────────────────────────────────
    // Setiap tx baru = event untuk pemiliknya. Hanya COMPLETED yang dipush
    // (PENDING/REJECTED tidak relevan untuk update UI realtime). Balance juga
    // berubah untuk tx COMPLETED → invalidasi cache balance di frontend.
    //
    // SILENT mode (swap flow): skip transaction:new supaya gak duplikat notif
    // badge. Swap flow record SWAP_IN/SWAP_OUT untuk history, TAPI notif real-
    // time di-handle WSS handler (yang lihat delivery on-chain). Tanpa silent,
    // user dapat 2-3 notif untuk 1 swap. balance:changed tetap dipush (refresh
    // saldo tetap perlu).
    if (tx.status === 'COMPLETED') {
      if (!params.silent) {
        this.realtime.push(params.userId, 'transaction:new', {
          id: tx.id,
          type: tx.type,
        });
      }
      this.realtime.push(params.userId, 'balance:changed', null);
    }

    return tx;
  }

  /**
   * Catat satu event P2P token transfer non-CC ke TokenTransaction.
   *
   * Paralel instrument-aware dari `recordTransaction` (yang strictly CC/micro-CC).
   * `amount` disimpan signed: debit (TRANSFER_OUT, FEE_OUT) → negatif, kredit →
   * positif. Decimal(38,18) match Cantex API decimal-string amounts.
   *
   * Dipakai oleh: POST /party/send-token (sender), accept/reject offer handler
   * (receiver), withdraw handler (sender). Idempotency via @@unique([userId, ledgerTxId]).
   */
  async recordTokenTransaction(params: {
    userId: string;
    instrumentId: string;
    instrumentAdmin: string;
    /** Jumlah token (positive). Akan di-sign di sini sesuai type (debit/kredit). */
    amount: Decimal | number | string;
    type: TokenTxType;
    description?: string;
    referenceId?: string | null;
    ledgerTxId?: string;
    cantonUpdateId?: string;
    status?: 'COMPLETED' | 'PENDING' | 'REJECTED';
    transferInstructionCid?: string | null;
    /** Jumlah token asli yang dibatalkan/ditarik (TOKEN_OFFER_WITHDRAWN / REJECTED).
     *  Saldo tidak bergerak (amount=0); ini hanya untuk display "cancelled X token". */
    cancelledAmount?: Decimal | number | string | null;
    /** SILENT: catat history TAPI jangan push transaction:new (anti duplikat
     *  notifikasi). Dipakai saat aksi juga dipantau WSS handler (accept/reject/
     *  withdraw offer) supaya user tidak dapat 2x notif untuk 1 aksi. */
    silent?: boolean;
  }) {
    const absAmount = new Decimal(Math.abs(Number(params.amount)));
    const signed = TOKEN_TX_DEBIT_TYPES.has(params.type)
      ? absAmount.neg()
      : absAmount;
    const tx = await this.prisma.tokenTransaction.create({
      data: {
        userId: params.userId,
        instrumentId: params.instrumentId,
        instrumentAdmin: params.instrumentAdmin,
        amount: signed,
        type: params.type,
        description: params.description ?? null,
        referenceId: params.referenceId ?? null,
        ledgerTxId: params.ledgerTxId ?? null,
        cantonUpdateId: params.cantonUpdateId ?? null,
        status: params.status ?? 'COMPLETED',
        transferInstructionCid: params.transferInstructionCid ?? null,
        cancelledAmount:
          params.cancelledAmount != null
            ? new Decimal(Math.abs(Number(params.cancelledAmount)))
            : null,
      },
    });

    // Realtime push (mirror recordTransaction). Hanya COMPLETED relevan untuk UI.
    // SILENT mode (accept/reject/withdraw offer): skip transaction:new supaya
    // tidak duplikat notif dengan WSS handler (yang lihat delivery on-chain).
    // balance:changed tetap dipush (UI wallet tetap refresh saldo).
    if (tx.status === 'COMPLETED') {
      if (!params.silent) {
        this.realtime.push(params.userId, 'transaction:new', {
          id: tx.id,
          type: tx.type,
        });
      }
      this.realtime.push(params.userId, 'balance:changed', null);
    }
    return tx;
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

    // Token feed + badge where-clauses (paralel CC, instrument-aware).
    const tokenFeedWhere = {
      userId,
      type: { in: FEED_TOKEN_TX_TYPES },
    } satisfies Prisma.TokenTransactionWhereInput;
    const tokenBadgeWhere: Prisma.TokenTransactionWhereInput = {
      userId,
      type: { in: BADGE_UNREAD_TOKEN_TX_TYPES },
      ...(lastSeenAt ? { createdAt: { gt: lastSeenAt } } : {}),
    };

    const [
      feedRows,
      badgeRows,
      tokenFeedRows,
      tokenBadgeRows,
      drawAlerts,
      codeClaimAlerts,
    ] = await Promise.all([
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
      // Token feed (non-CC, mis. USDCx transfer).
      this.prisma.tokenTransaction.findMany({
        where: tokenFeedWhere,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      // Token badge (unread count).
      this.prisma.tokenTransaction.findMany({
        where: tokenBadgeWhere,
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, createdAt: true },
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
    // Token badge: TOKEN_FEE_OUT sudah di-exclude via where-clause, sisanya unread.
    unreadTxCount += tokenBadgeRows.length;

    const enriched = await this.enrichQuestRewardDescriptions(feeFilteredFeed);
    const serializedCcTx = await Promise.all(
      enriched.map(async (tx) => {
        const counterparty =
          tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT'
            ? await this.resolveTransferCounterparty(tx.referenceId)
            : null;
        return {
          kind: 'transaction' as const,
          id: `cc-${tx.id}`,
          type: tx.type,
          description: tx.description,
          amountMicroCc: tx.amountMicroCc.toString(),
          referenceId: tx.referenceId,
          counterparty,
          createdAt: tx.createdAt.toISOString(),
          // Token-aware fields (kosong untuk CC murni).
          instrumentId: null,
          amountDecimal: null,
          // Cancelled-amount field (OFFER_WITHDRAWN / OFFER_REJECTED).
          cancelledAmountCc: tx.cancelledAmountCc
            ? tx.cancelledAmountCc.toString()
            : null,
          cancelledInstrumentId: tx.cancelledInstrumentId,
        };
      }),
    );
    // Serialize token rows — amount pakai decimal asli, instrumentId terisi.
    const serializedTokenTx = tokenFeedRows.map((tx) => ({
      kind: 'transaction' as const,
      id: `tok-${tx.id}`,
      type: tx.type,
      description: tx.description ?? '',
      amountMicroCc: '0',
      referenceId: tx.referenceId,
      counterparty: tx.referenceId,
      createdAt: tx.createdAt.toISOString(),
      instrumentId: tx.instrumentId,
      amountDecimal: tx.amount.toString(),
      // Cancelled-amount field (TOKEN_OFFER_WITHDRAWN / REJECTED).
      cancelledAmount: tx.cancelledAmount ? tx.cancelledAmount.toString() : null,
      cancelledInstrumentId: tx.instrumentId,
    }));

    const merged = [
      ...serializedCcTx,
      ...serializedTokenTx,
      ...drawAlerts,
      ...codeClaimAlerts,
    ]
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

  /**
   * Unified Activity feed — menggabungkan CcTransaction + TokenTransaction jadi
   * satu timeline terurut. Sebelumnya getTransactions() hanya baca CcTransaction,
   * sehingga transfer token non-CC (USDCx dll) — yang sudah direkam via
   * recordTokenTransaction — tidak pernah tampil di Activity. Method ini menutup
   * gap tersebut.
   *
   * Output backward-compatible dengan getTransactions(): setiap item CcTransaction
   * tetap punya field lama (amountMicroCc, type CcTransactionType, dst). Item
   * TokenTransaction menambah field opsional: instrumentId, amountDecimal, plus
   * amountMicroCc="0" sebagai placeholder agar frontend lama tidak crash.
   *
   * Prefix id "cc-" / "tok-" mencegah collision cuid antar dua tabel (keduanya
   * pakai cuid default).
   *
   * Fee-filter: CcTransaction pakai CC_TRANSACTION_HISTORY_WHERE +
   * isFeePartyRecipient (sama getTransactions). TokenTransaction skip type
   * TOKEN_FEE_OUT (fee CC untuk P2P token transfer, audit-only).
   */
  async getUnifiedActivity(userId: string, page: number, pageSize: number) {
    const tokenWhere = {
      userId,
      NOT: { type: 'TOKEN_FEE_OUT' as TokenTxType },
    };

    // Ambil proyeksi ringan kedua tabel (bounded — frontend minta pageSize=200).
    const [ccRows, tokenRows] = await Promise.all([
      this.prisma.ccTransaction.findMany({
        where: { userId, ...CC_TRANSACTION_HISTORY_WHERE },
        orderBy: { createdAt: 'desc' },
        select: { id: true, referenceId: true, type: true, createdAt: true },
      }),
      this.prisma.tokenTransaction.findMany({
        where: tokenWhere,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          referenceId: true,
          type: true,
          instrumentId: true,
          createdAt: true,
        },
      }),
    ]);

    // Post-filter fee-party recipient untuk CC (butuh resolve counterparty).
    type UnifiedRow = {
      kind: 'cc' | 'tok';
      id: string;
      referenceId: string | null;
      type: string;
      createdAt: Date;
      instrumentId?: string;
    };
    const merged: UnifiedRow[] = [];

    for (const row of ccRows) {
      const ccType = row.type as CcTransactionType;
      if (ccType === 'TRANSFER_IN' || ccType === 'TRANSFER_OUT') {
        const resolved = await this.resolveTransferCounterparty(
          row.referenceId,
        );
        if (isFeePartyRecipient(row.referenceId, resolved)) continue;
      }
      merged.push({
        kind: 'cc',
        id: `cc-${row.id}`,
        referenceId: row.referenceId,
        type: row.type,
        createdAt: row.createdAt,
      });
    }
    for (const row of tokenRows) {
      merged.push({
        kind: 'tok',
        id: `tok-${row.id}`,
        referenceId: row.referenceId,
        type: row.type,
        createdAt: row.createdAt,
        instrumentId: row.instrumentId,
      });
    }

    // Sort global by createdAt desc, lalu paginate.
    merged.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    const total = merged.length;
    const skip = (page - 1) * pageSize;
    const pageRows = merged.slice(skip, skip + pageSize);

    // Hydrate baris penuh untuk halaman ini.
    const ccIds = pageRows
      .filter((r) => r.kind === 'cc')
      .map((r) => r.id.slice(3)); // strip "cc-"
    const tokIds = pageRows
      .filter((r) => r.kind === 'tok')
      .map((r) => r.id.slice(4)); // strip "tok-"

    const [ccFull, tokFull] = await Promise.all([
      ccIds.length
        ? this.prisma.ccTransaction.findMany({
            where: { id: { in: ccIds } },
            orderBy: { createdAt: 'desc' },
          })
        : [],
      tokIds.length
        ? this.prisma.tokenTransaction.findMany({
            where: { id: { in: tokIds } },
            orderBy: { createdAt: 'desc' },
          })
        : [],
    ]);

    const ccById = new Map(ccFull.map((t) => [t.id, t]));
    const tokById = new Map(tokFull.map((t) => [t.id, t]));

    const enrichedCc = await this.enrichQuestRewardDescriptions(ccFull);

    // Map enriched by id (enrichedCc might reorder/dedupe — index by id).
    const enrichedCcById = new Map(enrichedCc.map((t) => [t.id, t]));

    // Build unified items PRESERVING merged order (createdAt desc global).
    const items = await Promise.all(
      pageRows.map(async (row): Promise<Record<string, unknown>> => {
        if (row.kind === 'cc') {
          const rawId = row.id.slice(3);
          const tx = enrichedCcById.get(rawId) ?? ccById.get(rawId);
          if (!tx) return null as unknown as Record<string, unknown>;
          const counterparty =
            (tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT') as boolean
              ? await this.resolveTransferCounterparty(tx.referenceId)
              : null;
          return {
            ...tx,
            id: row.id,
            amountMicroCc: tx.amountMicroCc.toString(),
            // Token-aware fields (kosong untuk CC murni).
            instrumentId: null,
            amountDecimal: null,
            counterparty,
            // Cancelled-amount field (hanya terisi untuk OFFER_WITHDRAWN /
            // OFFER_REJECTED). Serialize Decimal → string untuk JSON-safety.
            cancelledAmountCc: tx.cancelledAmountCc
              ? tx.cancelledAmountCc.toString()
              : null,
          };
        }
        // token row
        const rawId = row.id.slice(4);
        const tx = tokById.get(rawId);
        if (!tx) return null as unknown as Record<string, unknown>;
        return {
          // Backward-compat field CcTransaction (placeholder untuk frontend lama).
          id: row.id,
          amountMicroCc: '0',
          type: tx.type,
          description: tx.description ?? '',
          referenceId: tx.referenceId,
          ledgerTxId: tx.ledgerTxId,
          cantonUpdateId: tx.cantonUpdateId,
          settledAt: null,
          createdAt: tx.createdAt,
          status: tx.status,
          transferInstructionCid: tx.transferInstructionCid,
          counterparty: tx.referenceId,
          // Token-aware fields.
          instrumentId: tx.instrumentId,
          instrumentAdmin: tx.instrumentAdmin,
          amountDecimal: tx.amount.toString(),
          // Cancelled-amount field (hanya terisi untuk TOKEN_OFFER_WITHDRAWN /
          // TOKEN_OFFER_REJECTED). Saldo tidak bergerak (amount=0), ini untuk display.
          cancelledAmount: tx.cancelledAmount
            ? tx.cancelledAmount.toString()
            : null,
          cancelledInstrumentId: tx.instrumentId,
        };
      }),
    );

    return {
      items: items.filter(Boolean),
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

  /**
   * Saat offer pending di-accept/reject manual, update status tx reward terkait.
   *
   * `cantonUpdateId` (opsional) = Canton update_id dari exercise accept/reject
   * — bila diberikan, ditulis ke kolom cantonUpdateId supaya link explorer
   * langsung tersedia tanpa menunggu lazy-fill / indexer.
   */
  async markTransferInstructionSettled(
    transferInstructionCid: string,
    status: 'COMPLETED' | 'REJECTED',
    cantonUpdateId?: string,
  ): Promise<number> {
    // Ambil dulu row PENDING yang cocok supaya bisa bersihkan suffix deskripsi
    // "[pending — recipient must accept offer]" saat offer selesai (accept/reject).
    // Query KEDUA tabel: CcTransaction (CC) + TokenTransaction (token non-CC).
    // Sebelumnya hanya CcTransaction → baris TOKEN_TRANSFER_OUT sender macet
    // di PENDING walau sudah di-accept lawan.
    const [pendingCcRows, pendingTokenRows] = await Promise.all([
      this.prisma.ccTransaction.findMany({
        where: { transferInstructionCid, status: 'PENDING' },
        select: { id: true, userId: true, description: true },
      }),
      this.prisma.tokenTransaction.findMany({
        where: { transferInstructionCid, status: 'PENDING' },
        select: { id: true, userId: true, description: true },
      }),
    ]);
    if (pendingCcRows.length === 0 && pendingTokenRows.length === 0) return 0;

    const settledAt = status === 'COMPLETED' ? new Date() : null;
    // Kumpulkan userId pemilik row unik untuk realtime push di akhir (Fix:
    // sebelumnya sender tidak diberi tahu saat offer-nya di-accept/reject).
    const ownerIds = new Set<string>();

    // ── CcTransaction (CC) ──────────────────────────────────────────────────
    for (const row of pendingCcRows) {
      const cleanDesc = row.description
        .replace(/\s*\[pending[^\]]*\]\s*/i, '')
        .trim();
      await this.prisma.ccTransaction.update({
        where: { id: row.id },
        data: {
          status,
          settledAt,
          ...(cantonUpdateId ? { cantonUpdateId } : {}),
          ...(cleanDesc !== row.description ? { description: cleanDesc } : {}),
        },
      });
      ownerIds.add(row.userId);
    }

    // ── TokenTransaction (token non-CC, mis. USDCx) ─────────────────────────
    for (const row of pendingTokenRows) {
      const cleanDesc = (row.description ?? '')
        .replace(/\s*\[pending[^\]]*\]\s*/i, '')
        .trim();
      await this.prisma.tokenTransaction.update({
        where: { id: row.id },
        data: {
          status,
          ...(cantonUpdateId ? { cantonUpdateId } : {}),
          ...(cleanDesc !== (row.description ?? '')
            ? { description: cleanDesc }
            : {}),
        },
      });
      ownerIds.add(row.userId);
    }

    // Notifikasi langsung ke pemilik row (biasanya SENDER offer): row PENDING
    // mereka kini COMPLETED (CC/token diterima lawan) atau REJECTED (kembali).
    // recordTransaction() hanya push untuk tx COMPLETED baru; flip status PENDING
    // → COMPLETED lewat sini, jadi push eksplisit agar UI sender update live.
    // Untuk COMPLETED juga invalidate cache balance (CC keluar dari escrow).
    for (const ownerId of ownerIds) {
      this.realtime.push(ownerId, 'transaction:new', { status });
      if (status === 'COMPLETED') {
        this.realtime.push(ownerId, 'balance:changed', null);
      }
    }

    return pendingCcRows.length + pendingTokenRows.length;
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
