import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import Bull from 'bull';
type Queue = Bull.Queue;
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  QUEUE_EMAIL,
  JOB_CAMPAIGN_EMAIL_CHUNK,
} from '../queue/queue.constants';
import {
  normalizeRewardType,
  resolveQuestDisplayStatus,
  type EmailNotificationType,
} from '../common/prisma-types';
import {
  CampaignEmailService,
  type AnnouncementPayload,
  type WinnerPayload,
  type NotSelectedPayload,
} from './campaign-email.service';

/**
 * NotificationsService — API publik untuk email notifikasi campaign.
 *
 * Dipanggil hook admin (fire-and-forget, best-effort — kegagalan email TIDAK
 * boleh menggagalkan aksi admin):
 *   - createQuest() / updateQuest(COMING_SOON→ACTIVE) → announceCampaignCreated
 *   - drawWinners() → announceDrawWinners (pemenang baru di-draw)
 *   - drawWinners(announceResults) / updateQuest(→ENDED) → announceNotSelected
 *
 * Alur outbox:
 *   1. Query penerima (HANYA user ber-wallet — cantonPartyId terisi & bukan
 *      placeholder "canquest:", status ACTIVE, emailVerified, belum unsubscribe).
 *   2. createMany EmailNotificationLog PENDING + snapshot payload template
 *      (skipDuplicates → unique [userId, questId, type] = anti dobel kirim).
 *   3. Enqueue chunk job ke Bull `email-jobs` (stagger delay antar chunk).
 */

/** Filter penerima: user ber-wallet sungguhan yang masih mau menerima email. */
const WALLET_HOLDER_WHERE = {
  status: 'ACTIVE',
  emailVerified: true,
  emailNotificationsEnabled: true,
  cantonPartyId: { not: null },
  NOT: { cantonPartyId: { startsWith: 'canquest:' } },
} as const;

/** Tipe reward yang punya hasil draw (email winner/not-selected hanya untuk ini). */
const RAFFLE_REWARD_TYPES: ReadonlySet<string> = new Set([
  'CC_MANUAL',
  'INVITE_CODE_RANDOM',
  'CC_AND_CODE_RAFFLE',
  'CC_AND_INVITE',
  'WAITLIST_EMAIL',
]);

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: CampaignEmailService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
  ) {}

  // ── 1. Campaign baru ───────────────────────────────────────────────────────

  /** Blast "New campaign" ke semua user ber-wallet. Idempoten via log unique. */
  async announceCampaignCreated(questId: string): Promise<void> {
    if (!this.assertEnabled()) return;

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
      include: { tasks: { select: { id: true } } },
    });
    if (!quest || quest.questKind !== 'CAMPAIGN') return;
    // Hanya announce campaign yang sudah dibuka — quest COMING_SOON di-announce
    // saat status berubah ACTIVE (hook updateQuest), bukan saat dibuat.
    if (resolveQuestDisplayStatus(quest) !== 'ACTIVE') {
      this.logger.log(
        `Announcement skip: quest=${questId.slice(0, 8)} belum ACTIVE`,
      );
      return;
    }

    const recipients = await this.prisma.user.findMany({
      where: WALLET_HOLDER_WHERE,
      select: { id: true, email: true },
    });
    if (recipients.length === 0) return;

    const payload: AnnouncementPayload = {
      kind: 'announcement',
      title: quest.title,
      org: quest.projectName?.trim() || quest.org,
      rewardPool: this.rewardPoolLabel(quest),
      winnersLabel: quest.maxWinners
        ? `${quest.maxWinners} · raffle draw`
        : 'Raffle draw',
      endsLabel: this.endsLabel(quest),
      tasksLabel: this.tasksLabel(quest.tasks.length),
      campaignUrl: this.emails.webUrl(`/earn/${questId}`),
    };

    const created = await this.prisma.emailNotificationLog.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        questId,
        email: r.email,
        type: 'CAMPAIGN_ANNOUNCEMENT',
        payload: payload as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `Announcement queued: quest="${quest.title}" recipients=${recipients.length} new=${created.count}`,
    );
    await this.enqueuePending(questId, 'CAMPAIGN_ANNOUNCEMENT');
  }

  // ── 2. Pemenang draw ───────────────────────────────────────────────────────

  /** Email "You won" ke user yang baru dibuat WinnerDraw-nya oleh drawWinners(). */
  async announceDrawWinners(
    questId: string,
    winnerUserIds: string[],
  ): Promise<void> {
    if (!this.assertEnabled() || winnerUserIds.length === 0) return;

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest || quest.questKind !== 'CAMPAIGN') return;

    const winners = await this.prisma.user.findMany({
      where: { id: { in: winnerUserIds }, ...WALLET_HOLDER_WHERE },
      select: { id: true, email: true, username: true, displayName: true },
    });
    if (winners.length === 0) return;

    const draws = await this.prisma.winnerDraw.findMany({
      where: { questId, userId: { in: winners.map((w) => w.id) } },
      select: {
        userId: true,
        ccAmount: true,
        rewardToken: true,
        rewardVariant: true,
        inviteCode: true,
      },
    });
    const drawByUser = new Map(draws.map((d) => [d.userId, d]));

    const claimDeadline = this.claimDeadlineDate(quest);
    const data = winners.map((w) => {
      const draw = drawByUser.get(w.id);
      const payload: WinnerPayload = {
        kind: 'winner',
        title: quest.title,
        handle:
          w.displayName?.trim() || (w.username ? `@${w.username}` : 'winner'),
        rewardLabel: this.rewardLabel(draw, quest),
        claimByLabel: claimDeadline
          ? `Claim by ${formatDate(claimDeadline)}`
          : 'Claim via your dApp dashboard',
        claimUrl: this.emails.webUrl(`/earn/${questId}`),
      };
      return {
        userId: w.id,
        questId,
        email: w.email,
        type: 'CAMPAIGN_WINNER' as EmailNotificationType,
        payload: payload as unknown as Prisma.InputJsonValue,
      };
    });

    const created = await this.prisma.emailNotificationLog.createMany({
      data,
      skipDuplicates: true,
    });
    this.logger.log(
      `Winner emails queued: quest="${quest.title}" winners=${winners.length} new=${created.count}`,
    );
    await this.enqueuePending(questId, 'CAMPAIGN_WINNER');
  }

  // ── 3. Tidak terpilih ──────────────────────────────────────────────────────

  /**
   * Email "Raffle results" ke peserta (punya QuestCompletion) tanpa WinnerDraw.
   * Hanya untuk tipe raffle dan hanya setelah ada hasil draw — dipanggil saat
   * drawWinners(announceResults=true) atau updateQuest status → ENDED.
   */
  async announceNotSelected(questId: string): Promise<void> {
    if (!this.assertEnabled()) return;

    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest || quest.questKind !== 'CAMPAIGN') return;
    if (!RAFFLE_REWARD_TYPES.has(normalizeRewardType(quest.rewardType))) {
      // FCFS / CC_ONLY tidak punya hasil draw per peserta — tidak ada email kalah.
      return;
    }
    const drawCount = await this.prisma.winnerDraw.count({
      where: { questId },
    });
    if (drawCount === 0) {
      this.logger.log(
        `Not-selected skip: quest=${questId.slice(0, 8)} belum ada draw`,
      );
      return;
    }

    const recipients = await this.prisma.user.findMany({
      where: {
        ...WALLET_HOLDER_WHERE,
        questCompletions: { some: { questId } },
        winnerDraws: { none: { questId } },
      },
      select: { id: true, email: true },
    });
    if (recipients.length === 0) return;

    const liveCount = await this.prisma.quest.count({
      where: { questKind: 'CAMPAIGN', status: 'ACTIVE' },
    });
    const payload: NotSelectedPayload = {
      kind: 'not_selected',
      title: quest.title,
      liveLabel: `${liveCount} campaign${liveCount === 1 ? '' : 's'} open right now`,
      exploreUrl: this.emails.webUrl('/earn'),
    };

    const created = await this.prisma.emailNotificationLog.createMany({
      data: recipients.map((r) => ({
        userId: r.id,
        questId,
        email: r.email,
        type: 'CAMPAIGN_NOT_SELECTED',
        payload: payload as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
    this.logger.log(
      `Not-selected emails queued: quest="${quest.title}" recipients=${recipients.length} new=${created.count}`,
    );
    await this.enqueuePending(questId, 'CAMPAIGN_NOT_SELECTED');
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private assertEnabled(): boolean {
    if (this.config.get<string>('EMAIL_NOTIFICATIONS_ENABLED') === 'false') {
      return false;
    }
    if (!this.emails.isConfigured()) {
      // Dev tanpa RESEND_API_KEY — log-only, jangan ganggu aksi admin.
      this.logger.warn(
        'Campaign emails skipped (RESEND_API_KEY not set — dev log-only mode)',
      );
      return false;
    }
    return true;
  }

  /**
   * Enqueue chunk job untuk semua baris PENDING (questId, type). Processor
   * membaca ulang baris WHERE status=PENDING saat eksekusi, jadi job ganda /
   * chunk yang sudah terkirim otomatis skip (idempoten).
   */
  private async enqueuePending(
    questId: string,
    type: EmailNotificationType,
  ): Promise<void> {
    const rows = await this.prisma.emailNotificationLog.findMany({
      where: { questId, type, status: 'PENDING' },
      select: { id: true },
    });
    if (rows.length === 0) return;

    const chunkSize = this.emails.getChunkSize();
    const delayMs = this.emails.getChunkDelayMs();
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      await this.emailQueue.add(
        JOB_CAMPAIGN_EMAIL_CHUNK,
        { logIds: chunk },
        // Stagger delay antar chunk = rate limit Resend tanpa busy-wait.
        { delay: Math.floor(i / chunkSize) * delayMs },
      );
    }
  }

  private rewardPoolLabel(quest: {
    rewardPool: string;
    rewardCc: number;
    rewardToken: string;
  }): string {
    const pool = quest.rewardPool?.trim();
    if (pool && pool !== 'TBD') return pool;
    return quest.rewardCc > 0
      ? `${formatAmount(quest.rewardCc)} ${quest.rewardToken}`
      : 'Rewards';
  }

  private endsLabel(quest: {
    endsAt: Date | null;
    deadline: string | null;
  }): string {
    if (quest.endsAt) return formatDateTime(quest.endsAt);
    if (quest.deadline?.trim()) {
      const d = new Date(quest.deadline);
      if (Number.isFinite(d.getTime())) return formatDate(d);
    }
    return 'See campaign page';
  }

  private tasksLabel(count: number): string {
    if (count === 0) return 'See campaign page';
    const minutes = Math.min(60, Math.max(5, count * 5));
    return `${count} task${count === 1 ? '' : 's'} · ~${minutes} min`;
  }

  private claimDeadlineDate(quest: {
    endsAt: Date | null;
    deadline: string | null;
  }): Date | null {
    if (quest.endsAt) return quest.endsAt;
    if (quest.deadline?.trim()) {
      const d = new Date(quest.deadline);
      if (Number.isFinite(d.getTime())) return d;
    }
    return null;
  }

  /** Label reward sesuai rewardVariant WinnerDraw (CODE / CC / kombinasi legacy). */
  private rewardLabel(
    draw:
      | {
          ccAmount: number;
          rewardToken: string;
          rewardVariant: string | null;
          inviteCode: string | null;
        }
      | undefined,
    quest: { rewardCc: number; rewardToken: string },
  ): string {
    if (!draw) {
      return quest.rewardCc > 0
        ? `${formatAmount(quest.rewardCc)} ${quest.rewardToken}`
        : 'Reward';
    }
    if (draw.rewardVariant === 'CODE') return '1 Invite Code';
    if (draw.inviteCode && !draw.ccAmount) return '1 Invite Code';
    if (draw.ccAmount > 0) {
      const token = draw.rewardToken || quest.rewardToken;
      return `${formatAmount(draw.ccAmount)} ${token}`;
    }
    return 'Reward';
  }
}

// ── Format helpers (UTC, en-US — sesuai copy email English) ──────────────────

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const DATETIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatDate(d: Date): string {
  return DATE_FMT.format(d); // "Sep 5, 2026"
}

function formatDateTime(d: Date): string {
  return `${DATETIME_FMT.format(d).replace(',', '')} UTC`; // "Sep 5, 2026 23:59 UTC"
}

function formatAmount(n: number): string {
  // 50 → "50", 0.01 → "0.01", 2500 → "2,500"
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
