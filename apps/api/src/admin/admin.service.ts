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
import { randomInt, randomUUID } from 'crypto';
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
import { QuestLedgerService } from '../canton/quest-ledger.service';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { hasRealWallet } from '../common/wallet-policy';
import { PointsService } from '../users/points.service';
import {
  isAllowedEmailDomain,
  getDomainFromEmail,
  canonicalEmail,
} from '../common/disposable-email';

/**
 * Sebuah referral dianggap fraud bila salah satu:
 *   1. Email referred DI LUAR allowlist webmail (non-gmail/yahoo/outlook/…).
 *      → Flag per-item. User real memakai webmail; non-webmail kuat indikasi
 *        email sekali-pakai / catch-all.
 *   2. Gmail alias farming: satu pengundang mengundang ≥2 alamat gmail yang
 *      menormalisasi ke mailbox YANG SAMA (titik/plus diabaikan Gmail).
 *      → Kunci: Gmail mengirim semua varian titik/plus ke SATU inbox, jadi dua
 *        orang real TIDAK MUNGKIN punya bentuk kanonik yang sama. 2+ varian dari
 *        satu pengundang = pasti farming, ZERO false positive terhadap user
 *        real. Hanya duplikat dalam cluster yang diflag; varian tunggal (mis.
 *        john.doe@gmail.com yang sah) TIDAK diflag.
 */
type ReferralEmailSource = {
  referrerId: string;
  referredEmail?: string | null;
};

/**
 * Bangun set kunci (referrerId|canonicalEmail) yang muncul ≥2 kali (= cluster
 * farming gmail). Dipakai untuk flag item-item dalam cluster duplikat itu saja.
 */
function buildGmailClusterKeys(sources: ReferralEmailSource[]): Set<string> {
  const counts = new Map<string, number>();
  for (const s of sources) {
    const email = s.referredEmail;
    if (!email) continue;
    const domain = getDomainFromEmail(email);
    // Hanya gmail/googlemail yang menormalisasi titik (cluster hunting relevan
    // di sana). Domain lain: cluster pada bentuk persis (plus-addressing sudah
    // distrip oleh canonicalEmail).
    if (domain !== 'gmail.com' && domain !== 'googlemail.com') continue;
    const key = `${s.referrerId}|${canonicalEmail(email)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [key, n] of counts) if (n >= 2) dupes.add(key);
  return dupes;
}

/** true jika email referred di luar allowlist webmail. */
function isNonWebmailDomain(email: string | null | undefined): boolean {
  const domain = getDomainFromEmail(email);
  if (!domain) return false;
  return !isAllowedEmailDomain(domain);
}

/**
 * True jika sebuah referral termasuk gmail alias farming: domain gmail DAN
 * (referrerId|canonicalEmail)-nya ada di set cluster duplikat (≥2 varian).
 * Varian gmail TUNGGAL tidak diflag.
 */
function isInGmailCluster(
  email: string | null | undefined,
  referrerId: string,
  clusterKeys: Set<string>,
): boolean {
  if (!email) return false;
  const domain = getDomainFromEmail(email);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return false;
  return clusterKeys.has(`${referrerId}|${canonicalEmail(email)}`);
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly splice: SpliceValidatorService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly storage: R2StorageService,
    private readonly questLedger: QuestLedgerService,
    private readonly ledger: CantonLedgerService,
    private readonly points: PointsService,
  ) {}

  /** Drop replaced/removed banner & logo from R2 when not referenced by another quest. */
  private async cleanupQuestMediaUrls(
    questId: string,
    previous: { bannerImageUrl: string | null; logoUrl: string | null },
    next: { bannerImageUrl?: string | null; logoUrl?: string | null },
  ): Promise<void> {
    const tasks: Array<{
      field: 'bannerImageUrl' | 'logoUrl';
      old: string | null;
      neu: string | null;
    }> = [];

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
        this.logger.warn(
          `Skip delete ${field} asset still used by another quest: ${old}`,
        );
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
        _count: {
          select: {
            completions: true,
            submissions: true,
            inviteCodes: true,
            winnerDraws: true,
          },
        },
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
      {
        ...q,
        tags: this.parseTags(q.tags),
        socialLinks: parseQuestSocialLinks(q.socialLinks),
      },
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
        banner:
          'linear-gradient(135deg,rgba(90,217,138,0.35) 0%,rgba(17,24,39,0.9) 100%)',
        rewardCc: 0,
        rewardPool: 'Earn points',
        status: QuestStatus.ACTIVE,

        rewardType: RewardType.CC_ONLY as any,
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
            // Send-transaction daily tasks (1× / 3× / 5×) — wallet required, resets every 24h.
            // Required count stored in `target`; repeatEvery24h derived from type.
            {
              type: 'send_transaction',
              title: 'Send 1 transaction',
              points: 10,
              target: '1',
              order: 1,
            },
            {
              type: 'send_transaction',
              title: 'Send 3 transactions',
              points: 20,
              target: '3',
              order: 2,
            },
            {
              type: 'send_transaction',
              title: 'Send 5 transactions',
              points: 30,
              target: '5',
              order: 3,
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
      {
        ...q,
        tags: this.parseTags(q.tags),
        socialLinks: parseQuestSocialLinks(q.socialLinks),
      },
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
    if (
      normalizeRewardType((rewardType ?? RewardType.CC_ONLY) as RewardType) !==
      RewardType.CC_ONLY
    ) {
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
    codeWinnersQuota?: number | null;
    claimFeeCc?: number | null;
    winnerMessage?: string | null;
    redeemUrl?: string | null;
    redeemInstructions?: string | null;
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
        rewardPool:
          data.rewardPool ?? (data.rewardCc ? `${data.rewardCc} CC` : 'TBD'),
        maxWinners: data.maxWinners ?? null,
        codeWinnersQuota: data.codeWinnersQuota ?? null,
        claimFeeCc: data.claimFeeCc ?? null,
        deadline: data.deadline ?? null,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        status: data.status ?? QuestStatus.ACTIVE,

        rewardType: (data.rewardType ?? RewardType.CC_ONLY) as any,
        winnerMessage: data.winnerMessage?.trim() || null,
        redeemUrl: data.redeemUrl?.trim() || null,
        redeemInstructions: data.redeemInstructions?.trim() || null,
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

    // canquest-v6: Buat QuestCampaign on-chain setelah quest dibuat di DB.
    // Best-effort — tidak memblokir jika ledger tidak tersedia.
    // ledgerCampaignId disimpan ke DB agar claimFcfsSlot() bisa referensi contract.
    if (questKind === QuestKind.CAMPAIGN && this.questLedger.isConfigured()) {
      void (async () => {
        try {
          const questKindDaml = QuestLedgerService.mapRewardTypeToQuestKind(
            data.rewardType ?? RewardType.CC_ONLY,
            (data.maxWinners ?? 0) > 0,
          );
          const ledgerResult = await this.questLedger.createQuestCampaign({
            campaignId: quest.id,
            title: quest.title,
            questKind: questKindDaml,
            rewardCc: quest.rewardCc,
            claimFeeCc: quest.claimFeeCc ?? 0,
            maxWinners: quest.maxWinners ?? 0,
          });
          if (ledgerResult.contractId) {
            await this.prisma.quest.update({
              where: { id: quest.id },

              data: { ledgerCampaignId: ledgerResult.contractId } as any,
            });
            this.logger.log(
              `QuestCampaign on-chain: quest=${quest.id.slice(0, 8)} kind=${questKindDaml} contract=${ledgerResult.contractId.slice(0, 12)}...`,
            );
          } else if (ledgerResult.errors.length > 0) {
            this.logger.warn(
              `QuestCampaign ledger: ${ledgerResult.errors.join(' | ')}`,
            );
          }
        } catch (err) {
          this.logger.warn(`QuestCampaign ledger failed: ${String(err)}`);
        }
      })();
    }

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
      codeWinnersQuota?: number | null;
      claimFeeCc?: number | null;
      winnerMessage?: string | null;
      redeemUrl?: string | null;
      redeemInstructions?: string | null;
      tags?: string[];
      socialLinks?: QuestSocialLinkInput[];
    },
  ) {
    const existing = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!existing) throw new NotFoundException('Quest not found');

    const nextStarts =
      data.startsAt !== undefined
        ? data.startsAt
        : (existing.startsAt?.toISOString() ?? null);
    const nextEnds =
      data.endsAt !== undefined
        ? data.endsAt
        : (existing.endsAt?.toISOString() ?? null);
    this.assertQuestSchedule(nextStarts, nextEnds);
    const nextRewardType = data.rewardType ?? existing.rewardType;
    const nextMaxWinners =
      data.maxWinners !== undefined ? data.maxWinners : existing.maxWinners;
    this.assertCcFcfsMaxWinners(
      nextRewardType,
      nextMaxWinners,
      existing.questKind,
    );

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
        ...(data.description !== undefined && {
          description: data.description,
        }),
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

        ...(data.rewardType !== undefined && {
          rewardType: data.rewardType as any,
        }),
        ...(data.maxWinners !== undefined && { maxWinners: data.maxWinners }),
        ...(data.codeWinnersQuota !== undefined && {
          codeWinnersQuota: data.codeWinnersQuota,
        }),
        ...(data.claimFeeCc !== undefined && { claimFeeCc: data.claimFeeCc }),
        ...(data.winnerMessage !== undefined && {
          winnerMessage: data.winnerMessage?.trim() || null,
        }),
        ...(data.redeemUrl !== undefined && {
          redeemUrl: data.redeemUrl?.trim() || null,
        }),
        ...(data.redeemInstructions !== undefined && {
          redeemInstructions: data.redeemInstructions?.trim() || null,
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
    const existing = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
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
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
    if (!quest) throw new NotFoundException('Quest not found');
    const count = await this.prisma.questTask.count({ where: { questId } });
    const repeatEvery24h =
      data.type === 'daily_check_in' || data.type === 'send_transaction';
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
    const existing = await this.prisma.questTask.findUnique({
      where: { id: taskId },
    });
    if (!existing) throw new NotFoundException('Task not found');
    const nextType = data.type ?? existing.type;
    const repeatEvery24h =
      nextType === 'daily_check_in' || nextType === 'send_transaction';
    return this.prisma.questTask.update({
      where: { id: taskId },
      data: {
        ...(data.type !== undefined && { type: data.type }),
        ...(data.title !== undefined && { title: data.title }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.points !== undefined && { points: data.points }),
        ...(data.target !== undefined && { target: data.target }),
        ...(data.order !== undefined && { order: data.order }),
        ...(data.correctAnswer !== undefined && {
          correctAnswer: data.correctAnswer,
        }),
        ...(data.showNewBadge !== undefined && {
          showNewBadge: data.showNewBadge,
        }),
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

  private csvFromRows(
    header: string[],
    dataRows: (string | number | null)[][],
  ): string {
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

    const rewardType = normalizeRewardType(quest.rewardType);

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

    const rewardType = normalizeRewardType(quest.rewardType);
    if (
      rewardType === RewardType.INVITE_CODE_RANDOM ||
      rewardType === RewardType.INVITE_CODE ||
      rewardType === RewardType.CC_AND_CODE_RAFFLE
    ) {
      const codeCount = await this.prisma.inviteCodePool.count({
        where: { questId, userId: null },
      });
      if (codeCount === 0) {
        throw new BadRequestException(
          'Add invite codes on the Winners page before running a draw.',
        );
      }
      // CC_AND_CODE_RAFFLE dengan variant split: kuota CODE harus ≤ kode tersedia.
      if (
        rewardType === RewardType.CC_AND_CODE_RAFFLE &&
        quest.codeWinnersQuota != null &&
        quest.codeWinnersQuota > codeCount
      ) {
        throw new BadRequestException(
          `Not enough codes: you set ${quest.codeWinnersQuota} Code winners but only ${codeCount} codes are available.`,
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

    // CC_AND_CODE_RAFFLE variant split: bila admin menetapkan codeWinnersQuota,
    // bagi pemenang terpilih menjadi varian CODE dan CC (acak, dikunci saat draw).
    // Null/0 quota = perilaku lama (semua pemenang "both", rewardVariant null).
    const useVariantSplit =
      rewardType === RewardType.CC_AND_CODE_RAFFLE &&
      quest.codeWinnersQuota != null &&
      quest.codeWinnersQuota > 0;

    // Map userId -> rewardVariant ('CODE' | 'CC' | null). Null = legacy both.
    const variantByUser = new Map<string, 'CODE' | 'CC' | null>();
    if (useVariantSplit) {
      // Acak urutan pemenang (Fisher–Yates dengan CSPRNG), lalu tetapkan kuota
      // pertama sebagai CODE dan sisanya sebagai CC.
      const shuffled = [...selectedUserIds];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = randomInt(0, i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const codeCount = Math.min(quest.codeWinnersQuota!, shuffled.length);
      for (let i = 0; i < shuffled.length; i++) {
        variantByUser.set(shuffled[i], i < codeCount ? 'CODE' : 'CC');
      }
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
      rewardVariant: 'CODE' | 'CC' | null;
    }> = [];

    for (let i = 0; i < selectedUserIds.length; i++) {
      const uid = selectedUserIds[i];
      const code = deferCodeAssignment ? null : (availableCodes[i] ?? null);
      const variant = variantByUser.get(uid) ?? null;

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

      // Varian menentukan janji reward: CODE → kode (ccAmount 0, kode di-claim
      // nanti); CC → token (ccAmount = rewardCc, tanpa kode); null → both (legacy).
      const promisedCc =
        variant === 'CODE' ? 0 : variant === 'CC' ? quest.rewardCc : quest.rewardCc;

      await this.prisma.winnerDraw.create({
        data: {
          questId,
          userId: uid,
          ccAmount: promisedCc,
          inviteCode: code?.code ?? null,
          distributed: false,
          rewardVariant: variant,
        },
      });

      const user = await this.users.findById(uid);
      if (user)
        results.push({
          userId: uid,
          email: user.email,
          ccAmount: promisedCc,
          inviteCode: code?.code ?? null,
          rewardVariant: variant,
        });
    }

    return { added: results.length, winners: results };
  }

  async getWinners(questId: string) {
    const draws = await this.prisma.winnerDraw.findMany({
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
      rewardVariant: d.rewardVariant as 'CODE' | 'CC' | null,
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
      select: { rewardType: true, title: true },
    });
    if (quest) {
      const rt = normalizeRewardType(quest.rewardType);
      if (
        rt === RewardType.CC_MANUAL ||
        rt === RewardType.INVITE_CODE_RANDOM ||
        rt === RewardType.INVITE_CODE ||
        rt === RewardType.WAITLIST_EMAIL ||
        rt === RewardType.CC_AND_CODE_RAFFLE
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
          select: {
            id: true,
            email: true,
            username: true,
            cantonPartyId: true,
          },
        },
      },
    });

    if (draws.length === 0) return { distributed: 0, failed: 0, results: [] };

    const results: Array<{
      drawId: string;
      userId: string;
      email: string;
      ccSent: boolean;
      ccAmount: number;
      inviteCode: string | null;
      error: string | null;
    }> = [];

    // Quest title dipakai sebagai deskripsi reward — sudah di-fetch di atas
    // (bersama rewardType). Cukup ambil label-nya, jangan fetch ulang per draw.
    const rewardLabel = quest?.title ?? 'Quest';

    for (const draw of draws) {
      const user = draw.user;
      let ccSent = false;
      let ledgerTxId: string | null = null;
      let rewardPending = false;
      let rewardInstructionCid: string | null = null;
      let failureReason: string | null = null;

      // ⚠️ SECURITY (C3): Atomic claim BEFORE sending CC. Two concurrent
      // distribute requests (double-click, two admin tabs, retry storm) both
      // read `distributed:false` above and would both call sendReward → the
      // winner is paid twice. We atomically flip the draw to distributed=true
      // with a conditional updateMany: only the request that affects count===1
      // owns the draw. Others get count===0 and skip. Mirrors the
      // acquireFcfsOnChainLock pattern in quests.service.ts.
      const claimed = await this.prisma.winnerDraw.updateMany({
        where: { id: draw.id, distributed: false },
        data: { distributed: true },
      });
      if (claimed.count !== 1) {
        // Another concurrent request already claimed this draw — skip it to
        // avoid a double payout. It will be reported as already-handled.
        results.push({
          drawId: draw.id,
          userId: draw.userId,
          email: draw.user.email,
          ccSent: true,
          ccAmount: draw.ccAmount,
          inviteCode: draw.inviteCode,
          error: 'Already distributed by a concurrent request',
        });
        this.logger.warn(
          `DISTRIBUTE_SKIP draw=${draw.id}: already claimed concurrently`,
        );
        continue;
      }

      if (draw.ccAmount > 0 && user.cantonPartyId) {
        try {
          const rewardResult = await this.splice.sendReward({
            receiverPartyId: user.cantonPartyId,
            amountCc: draw.ccAmount,
            description: rewardLabel,
          });
          if (rewardResult.ok) {
            ccSent = true; // dispatched (direct atau pending offer)
            ledgerTxId = rewardResult.rewardTxId ?? null;
            rewardPending = rewardResult.pending;
            rewardInstructionCid = rewardResult.transferInstructionCid ?? null;
          } else {
            failureReason =
              rewardResult.error ?? 'Reward transfer failed on-chain';
          }
        } catch (err) {
          failureReason = err instanceof Error ? err.message : String(err);
        }

        // SECURITY (C3): recordTransaction is OUTSIDE the sendReward try/catch.
        // Once sendReward succeeds, CC has left the wallet on-chain (irreversible).
        // If recordTransaction threw inside the try above, failureReason would be
        // set and distributed would flip back to false → a retry would sendReward
        // AGAIN (double payout). Now a DB-history failure is logged but does NOT
        // mark the draw as failed, because the money already moved. We persist the
        // ledgerTxId so a support reconciliation can backfill the history row.
        if (ccSent) {
          try {
            await this.users.recordTransaction({
              userId: user.id,
              amountCc: draw.ccAmount,
              type: 'QUEST_REWARD',
              description: rewardLabel,
              referenceId: questId,
              ledgerTxId: ledgerTxId ?? undefined,
              status: rewardPending ? 'PENDING' : 'COMPLETED',
              transferInstructionCid: rewardInstructionCid,
            });
          } catch (recordErr) {
            // CC already moved — do NOT mark distributed=false. Log + persist txId.
            this.logger.error(
              `DISTRIBUTE_HISTORY_FAIL draw=${draw.id}: CC sent (txId=${ledgerTxId ?? 'n/a'}) but history record threw: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
            );
          }
        }
      } else if (draw.ccAmount <= 0) {
        // Tidak ada CC untuk dikirim (mis. winner varian CODE atau ccAmount 0).
        // Tidak ada transfer gagal — anggap selesai tanpa CC.
        ccSent = true;
      } else if (!user.cantonPartyId) {
        failureReason =
          'Winner has no Canton wallet (cantonPartyId missing) — cannot send CC';
      }

      if (failureReason) {
        this.logger.warn(
          `DISTRIBUTE_FAIL draw=${draw.id} user=${user.email}: ${failureReason}`,
        );
      }

      // ⚠️ Anti-silent-failure: distributed HANYA true jika CC benar-benar terkirim
      // (atau tidak ada CC yang perlu dikirim). Sebelumnya distributed selalu di-set
      // true walau transfer gagal → user tidak bisa retry & UI bilang "Sent" padahal
      // CC tidak masuk. Sekarang draw yang gagal tetap `distributed=false` sehingga
      // tombol Send muncul lagi di admin UI dan bisa di-retry tanpa double-pay
      // (query filter `distributed:false` + endpoint claim juga cek distributed).
      // NOTE: we already flipped distributed=true above for the atomic claim. If
      // the transfer failed (ccSent=false) we flip it BACK to false so the draw
      // remains retryable — and so a later retry can re-claim it.
      await this.prisma.winnerDraw.update({
        where: { id: draw.id },
        data: {
          distributed: ccSent,
          // Jangan overwrite ledgerTxId yang sudah ada dengan null saat retry gagal.
          ...(ledgerTxId ? { ledgerTxId } : {}),
          distributedAt: ccSent ? new Date() : null,
        },
      });

      results.push({
        drawId: draw.id,
        userId: draw.userId,
        email: draw.user.email,
        ccSent,
        ccAmount: draw.ccAmount,
        inviteCode: draw.inviteCode,
        error: failureReason,
      });

      this.logger.log(
        `Reward distribute draw=${draw.id}: ${draw.user.email} — ${draw.ccAmount} CC (sent: ${String(ccSent)}) code: ${draw.inviteCode ?? 'none'}` +
          (failureReason ? ` reason=${failureReason}` : ''),
      );
    }

    const sentCount = results.filter((r) => r.ccSent).length;
    const failedCount = results.length - sentCount;
    return { distributed: sentCount, failed: failedCount, results };
  }

  /* ────────────────────────────────────────────────────────
     INVITE CODE MANAGEMENT
  ──────────────────────────────────────────────────────── */

  async addInviteCodes(questId: string, codes: string[]) {
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
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
      assignedTo: c.user
        ? { email: c.user.email, username: c.user.username }
        : null,
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
    const quest = await this.prisma.quest.findUnique({
      where: { id: questId },
    });
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

  async listUsers(
    page = 1,
    pageSize = 20,
    search?: string,
    sort: 'recent' | 'points_desc' = 'recent',
  ) {
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

    const orderBy =
      sort === 'points_desc'
        ? [{ earnPoints: 'desc' as const }, { createdAt: 'desc' as const }]
        : [{ createdAt: 'desc' as const }];

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          cantonPartyId: true,
          isAdmin: true,
          emailVerified: true,
          status: true,
          bannedAt: true,
          createdAt: true,
          earnPoints: true,
          referredById: true,
          referralCode: true,
          ccBalance: { select: { balanceMicroCc: true } },
          _count: {
            select: {
              questCompletions: true,
              referralRewardsGiven: true,
            },
          },
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

  /**
   * Set a user's account status (ACTIVE | SUSPENDED | BANNED).
   * - Admin & protected-email accounts cannot be banned/suspended.
   * - Ban/suspend revokes ALL refresh tokens (kicks every session); access tokens
   *   expire on their own (≤15 mnt). Phase 1 only — does not touch on-chain funds.
   */
  async setUserStatus(
    userId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'BANNED',
    reason?: string,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isAdmin: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const protectedEmails = this.getProtectedAdminEmails();
    if (
      status !== 'ACTIVE' &&
      (target.isAdmin || protectedEmails.has(target.email.toLowerCase()))
    ) {
      throw new BadRequestException('Cannot ban or suspend an admin account');
    }

    const isActive = status === 'ACTIVE';
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status,
          bannedAt: isActive ? null : new Date(),
          banReason: isActive ? null : reason?.trim() || null,
        },
      }),
      // Kick every session on ban/suspend; nothing to do on unban.
      ...(isActive
        ? []
        : [
            this.prisma.refreshToken.updateMany({
              where: { userId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]),
    ]);

    this.logger.warn(
      `User ${target.email} status → ${status}${reason ? ` (${reason})` : ''}`,
    );
    return { ok: true, id: userId, status };
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
      (u) => u.isAdmin || protectedEmails.has(u.email.toLowerCase()),
    );
    const toDelete = found.filter(
      (u) => !u.isAdmin && !protectedEmails.has(u.email.toLowerCase()),
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

    // Clawback sebelum hapus: cabut semua ReferralReward yang diberikan user-user
    // ini selaku referrer, supaya tidak ada poin phantom tersisa & poin merekonsiliasi.
    // ReferralReward.referrer memiliki onDelete: Cascade — kalau tidak dicabut dulu,
    // reward-nya otomatis terhapus TANPA clawback earnPoints. Maka lakukan eksplisit.
    for (const id of deleteIds) {
      const given = await this.prisma.referralReward.findMany({
        where: { referrerId: id },
        select: { referredUserId: true },
      });
      for (const g of given) {
        await this.revokeReferral(g.referredUserId).catch((err) => {
          this.logger.warn(
            `Clawback skipped during delete (user ${id}): ${err?.message ?? err}`,
          );
        });
      }
    }

    const result = await this.prisma.user.deleteMany({
      where: { id: { in: deleteIds } },
    });

    for (const u of toDelete) {
      this.logger.warn(`Deleted user ${u.email} (${u.id})`);
    }

    return {
      deleted: result.count,
      blocked: blocked.map((u) => ({
        id: u.id,
        email: u.email,
        reason: 'admin',
      })),
      notFound: missing,
    };
  }

  /* ────────────────────────────────────────────────────────
     Referral moderation — list, revoke (clawback), and fraud sweep.
     Used by /admin/users (view referrals) and /admin/referrals (audit).
     ──────────────────────────────────────────────────────── */

  /**
   * Daftar ReferralReward yang diberikan seorang user (siapa yang dia undang).
   * Menyertakan flag nonAllowedDomain untuk menandai referral dari email di luar
   * allowlist webmail (indikasi kuat fraud).
   */
  async getUserReferrals(userId: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isAdmin: true, earnPoints: true },
    });
    if (!owner) throw new NotFoundException('User not found');

    const rewards = await this.prisma.referralReward.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        referredUser: {
          select: {
            id: true,
            email: true,
            emailVerified: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    // Bangun cluster duplikat gmail (referrerId ini saja). Hanya varian yang
    // menormalisasi ke mailbox sama ≥2 kali yang dianggap farming.
    const clusterKeys = buildGmailClusterKeys(
      rewards.map((r) => ({
        referrerId: userId,
        referredEmail: r.referredUser?.email,
      })),
    );

    return {
      referrer: {
        id: owner.id,
        email: owner.email,
        earnPoints: owner.earnPoints,
      },
      referrals: rewards.map((r) => {
        const email = r.referredUser?.email;
        const domain = getDomainFromEmail(email);
        const inCluster = isInGmailCluster(email, userId, clusterKeys);
        const nonWebmail = isNonWebmailDomain(email);
        return {
          rewardId: r.id,
          referredUserId: r.referredUserId,
          referredEmail: email ?? '(deleted user)',
          referredDomain: domain,
          nonAllowedDomain: nonWebmail,
          isGmailAlias: inCluster,
          canonicalEmail: canonicalEmail(email),
          // Flag gabungan: non-webmail domain ATAU bagian cluster gmail duplikat.
          // Gmail biasa tunggal (mis. john.doe@gmail.com) TIDAK diflag.
          fraudSignal: nonWebmail || inCluster,
          referredStatus: r.referredUser?.status ?? null,
          referredVerified: r.referredUser?.emailVerified ?? false,
          referredCreatedAt: r.referredUser?.createdAt ?? null,
          points: r.points,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  /**
   * Cabut satu ReferralReward (berdasarkan referredUserId) + clawback poin
   * pengundang. Hapus record referral lalu reconcile earnPoints referrer
   * sehingga poin turun permanen (Math.max di reconcile tidak akan menghidupkan
   * lagi karena sumber reward sudah hilang).
   */
  async revokeReferral(referredUserId: string) {
    const reward = await this.prisma.referralReward.findUnique({
      where: { referredUserId },
      select: {
        id: true,
        referrerId: true,
        referredUserId: true,
        points: true,
        referrer: { select: { email: true, isAdmin: true } },
      },
    });
    if (!reward) {
      throw new NotFoundException('Referral reward not found for this user');
    }

    // Lindungi admin: jangan clawback jika referrer adalah admin.
    const protectedEmails = this.getProtectedAdminEmails();
    if (
      reward.referrer.isAdmin ||
      protectedEmails.has(reward.referrer.email.toLowerCase())
    ) {
      throw new BadRequestException('Cannot revoke referral of an admin account');
    }

    // 1. Hapus record referral (sumber poin).
    await this.prisma.referralReward.delete({ where: { id: reward.id } });

    // 2. Null-kan referredById si referred (optional, relasi onDelete: SetNull
    //    hanya berlaku saat User dihapus; di sini user tetap, jadi bersihkan manual).
    await this.prisma.user
      .update({
        where: { id: reward.referredUserId },
        data: { referredById: null },
      })
      .catch(() => {
        /* referred user mungkin sudah dihapus — abaikan */
      });

    // 3. Reconcile earnPoints referrer ke nilai computed pasca-hapus.
    //    Karena reward hilang dari sumber, aggregate menghasilkan nilai lebih rendah;
    //    kita paksa tulis ulang earnPoints (bukan Math.max) supaya clawback permanen.
    const computed = await this.points.aggregateUserPoints(reward.referrerId);
    await this.prisma.user.update({
      where: { id: reward.referrerId },
      data: { earnPoints: computed },
    });

    this.logger.warn(
      `Referral revoked: referrer ${reward.referrerId} lost ${reward.points} pts ` +
        `(referred ${reward.referredUserId}). earnPoints → ${computed}.`,
    );

    return {
      ok: true,
      revoked: true,
      referrerId: reward.referrerId,
      referredUserId: reward.referredUserId,
      pointsClawedBack: reward.points,
      referrerEarnPointsNow: computed,
    };
  }

  /**
   * Pra-tinjau fraud: semua ReferralReward di mana email referred DI LUAR allowlist.
   * Mengelompokkan per-pengundang untuk sweep massal. Aman dipanggil read-only.
   */
  async listReferralFraud() {
    const rewards = await this.prisma.referralReward.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        referrer: {
          select: {
            id: true,
            email: true,
            isAdmin: true,
            status: true,
            earnPoints: true,
            referralCode: true,
          },
        },
        referredUser: {
          select: {
            id: true,
            email: true,
            emailVerified: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    const protectedEmails = this.getProtectedAdminEmails();
    // Bangun cluster duplikat gmail di seluruh dataset (per referrer). Hanya
    // varian yang menormalisasi ke mailbox sama ≥2 kali dari satu pengundang yang
    // dianggap farming. Gmail tunggal (mis. john.doe@gmail.com) TIDAK diflag.
    const clusterKeys = buildGmailClusterKeys(
      rewards.map((r) => ({
        referrerId: r.referrerId,
        referredEmail: r.referredUser?.email,
      })),
    );
    // Flag: non-webmail domain ATAU bagian cluster gmail duplikat.
    const flagged = rewards.filter((r) => {
      const email = r.referredUser?.email;
      return (
        isNonWebmailDomain(email) ||
        isInGmailCluster(email, r.referrerId, clusterKeys)
      );
    });

    // Ringkasan per-pengundang.
    const byReferrer = new Map<
      string,
      {
        referrerId: string;
        referrerEmail: string;
        referrerEarnPoints: number;
        isAdmin: boolean;
        isProtected: boolean;
        flaggedCount: number;
        totalPoints: number;
      }
    >();
    for (const r of flagged) {
      const existing =
        byReferrer.get(r.referrerId) ??
        {
          referrerId: r.referrerId,
          referrerEmail: r.referrer.email,
          referrerEarnPoints: r.referrer.earnPoints,
          isAdmin: r.referrer.isAdmin,
          isProtected: protectedEmails.has(
            r.referrer.email.toLowerCase(),
          ),
          flaggedCount: 0,
          totalPoints: 0,
        };
      existing.flaggedCount += 1;
      existing.totalPoints += r.points;
      byReferrer.set(r.referrerId, existing);
    }

    return {
      totalFlagged: flagged.length,
      referrers: [...byReferrer.values()].sort(
        (a, b) => b.totalPoints - a.totalPoints,
      ),
      referrals: flagged.map((r) => {
        const email = r.referredUser?.email;
        return {
          rewardId: r.id,
          referrerId: r.referrerId,
          referrerEmail: r.referrer.email,
          referredUserId: r.referredUserId,
          referredEmail: email ?? '(deleted user)',
          referredDomain: getDomainFromEmail(email),
          isGmailAlias: isInGmailCluster(email, r.referrerId, clusterKeys),
          canonicalEmail: canonicalEmail(email),
          referredStatus: r.referredUser?.status ?? null,
          points: r.points,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  /**
   * Bulk revoke banyak ReferralReward sekaligus + clawback per referrer.
   * Dipakai untuk sweep massal referral fraud (ribuan item). Jauh lebih cepat &
   * reliable daripada memanggil revokeReferral() satu per satu dari browser.
   *
   * Mode:
   * - ids:   hapus reward berdasarkan referredUserId tertentu (centangan admin).
   * - all:   hapus SEMUA reward yang referred-nya di luar allowlist (auto-flag).
   *
   * Strategi: kelompokkan reward yang akan dihapus per referrer, hapus massal
   * dalam satu deleteMany, lalu reconcile setiap referrer SEKALI (bukan per reward).
   * Mengembalikan ringkasan: jumlah dihapus, total poin clawback, error.
   */
  async revokeReferralsBulk(opts: {
    referredUserIds?: string[];
    all?: boolean;
  }) {
    const requestedIds = [...new Set((opts.referredUserIds ?? []).map((id) => id.trim()).filter(Boolean))];
    const useAll = opts.all === true;

    if (!useAll && requestedIds.length === 0) {
      throw new BadRequestException('No referral IDs provided');
    }

    // 1. Ambil semua reward yang akan dihapus (filter allowlist jika mode all).
    const protectedEmails = this.getProtectedAdminEmails();
    const allRewards = await this.prisma.referralReward.findMany({
      select: {
        id: true,
        referrerId: true,
        referredUserId: true,
        points: true,
        referrer: { select: { email: true, isAdmin: true } },
        referredUser: { select: { email: true } },
      },
    });

    // Bangun cluster duplikat gmail sebelum filter (perlu seluruh dataset).
    const clusterKeys = buildGmailClusterKeys(
      allRewards.map((r) => ({
        referrerId: r.referrerId,
        referredEmail: r.referredUser?.email,
      })),
    );

    const target = allRewards.filter((r) => {
      if (r.referrer.isAdmin || protectedEmails.has(r.referrer.email.toLowerCase())) {
        return false; // lindungi admin
      }
      if (useAll) {
        // mode all: non-webmail domain ATAU bagian cluster gmail duplikat.
        // Gmail tunggal yang sah TIDAK ikut terhapus.
        const email = r.referredUser?.email;
        return (
          isNonWebmailDomain(email) ||
          isInGmailCluster(email, r.referrerId, clusterKeys)
        );
      }
      // mode ids: yang dicentang admin
      return requestedIds.includes(r.referredUserId);
    });

    if (target.length === 0) {
      return {
        ok: true,
        revoked: 0,
        pointsClawedBack: 0,
        referrersUpdated: 0,
        skippedAdmin: 0,
        message: 'Nothing to revoke',
      };
    }

    const targetIds = target.map((r) => r.id);
    const referrerIds = [...new Set(target.map((r) => r.referrerId))];

    // 2. Hapus massal SEMUA reward target dalam satu query.
    const deleteResult = await this.prisma.referralReward.deleteMany({
      where: { id: { in: targetIds } },
    });

    // 3. Null-kan referredById semua referred user terkait (batch).
    const referredIds = target.map((r) => r.referredUserId).filter(Boolean);
    if (referredIds.length > 0) {
      await this.prisma.user
        .updateMany({
          where: { id: { in: referredIds } },
          data: { referredById: null },
        })
        .catch(() => {
          /* referred user mungkin sudah dihapus — abaikan */
        });
    }

    // 4. Reconcile setiap referrer SEKALI (recompute earnPoints pasca-hapus).
    //    Karena semua reward target sudah hilang dari sumber, aggregate otomatis
    //    menghasilkan nilai lebih rendah; tulis ulang earnPoints supaya permanen.
    let totalClawed = 0;
    for (const r of target) totalClawed += r.points;

    await Promise.all(
      referrerIds.map(async (referrerId) => {
        const computed = await this.points.aggregateUserPoints(referrerId);
        await this.prisma.user.update({
          where: { id: referrerId },
          data: { earnPoints: computed },
        });
      }),
    );

    const skippedAdmin = allRewards.length - target.length - (useAll ? 0 : 0);

    this.logger.warn(
      `Bulk referral revoke: ${deleteResult.count} rewards deleted, ` +
        `${totalClawed} pts clawed back across ${referrerIds.length} referrer(s).`,
    );

    return {
      ok: true,
      revoked: deleteResult.count,
      pointsClawedBack: totalClawed,
      referrersUpdated: referrerIds.length,
      skippedAdmin,
    };
  }

  private getProtectedAdminEmails(): Set<string> {
    const raw =
      this.config.get<string>('ADMIN_EMAILS') ?? process.env.ADMIN_EMAILS ?? '';
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
      ccDistributed,
      codesAvailable,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.quest.count({ where: { questKind: QuestKind.CAMPAIGN } }),
      this.prisma.quest.findFirst({
        where: { questKind: QuestKind.EARN_HUB },
        include: { _count: { select: { tasks: true, submissions: true } } },
      }),
      this.prisma.questCompletion.count(),
      this.prisma.winnerDraw.count({ where: { distributed: true } }),
      // Total CC yang sudah didistribusi sebagai reward quest (read-only aggregate).
      // CcTransaction menyimpan micro-CC (BigInt); konversi ke CC.
      this.prisma.ccTransaction.aggregate({
        where: { type: 'QUEST_REWARD' },
        _sum: { amountMicroCc: true },
      }),
      // Kode undangan kampanye yang belum di-assign (read-only count).
      this.prisma.inviteCodePool.count({ where: { userId: null } }),
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
      // Konversi micro-CC (BigInt) → CC (number). _sum mungkin undefined/null bila kosong.
      totalCcDistributed: ccDistributed._sum?.amountMicroCc
        ? Number(ccDistributed._sum.amountMicroCc) / 1_000_000
        : 0,
      codesAvailable,
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
      params.codes?.map((c) => c.trim()).filter(Boolean) ?? // custom code: store as-is (case-sensitive)
      this.generateWalletCodes(Math.min(Math.max(params.count ?? 1, 1), 500));

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
    const row = await this.prisma.walletInviteCode.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Wallet invite code not found');
    if (row.redeemedAt) {
      throw new BadRequestException(
        'Cannot delete a code that has already been used.',
      );
    }
    await this.prisma.walletInviteCode.delete({ where: { id } });
    return { ok: true };
  }

  /* ────────────────────────────────────────────────────────
     HELPERS
  ──────────────────────────────────────────────────────── */

  private parseTags(raw: string): string[] {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  /** Generate random invite codes (admin utility). */
  generateCodes(count: number, prefix = 'CQ'): string[] {
    return Array.from(
      { length: count },
      () => `${prefix}-${randomUUID().split('-')[0].toUpperCase()}`,
    );
  }

  private static readonly WALLET_CODE_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  /** Wallet invite code: 8 random chars (digits + upper + lower), no prefix. */
  generateWalletCodes(count: number): string[] {
    const alphabet = AdminService.WALLET_CODE_ALPHABET;
    return Array.from({ length: count }, () => {
      let code = '';
      for (let i = 0; i < 8; i++) {
        code += alphabet[randomInt(0, alphabet.length)]; // CSPRNG, unbiased
      }
      return code;
    });
  }

  /**
   * Diagnose TransferPreapproval status for a user across all sources.
   *
   * Used by admins to investigate the "toggle shows Disabled but transfers still
   * arrive directly" symptom. Reports what each source sees so we can tell a
   * rights gap (operator CanActAs/CanReadAs) from a normalization mismatch from
   * a provider-side-only-visible contract.
   *
   * @param lookup - partyId OR username (with or without leading @).
   */
  async debugPreapproval(lookup: string): Promise<{
    input: string;
    resolvedPartyId: string | null;
    resolvedUsername: string | null;
    hasWallet: boolean;
    authoritative: {
      active: boolean;
      source?: string;
      expiresAt?: string;
      provider?: string;
      contractId?: string;
    };
    sources: {
      ledgerReceiver: boolean;
      ledgerProvider: boolean;
      splice: boolean | null;
    };
    spliceRest: {
      active: boolean;
      expiresAt?: string;
      provider?: string;
    };
  }> {
    // Resolve a user by partyId or username.
    const trimmed = lookup.trim();
    const looksLikeParty = trimmed.includes('::');
    let partyId: string | null = null;
    let username: string | null = null;

    if (looksLikeParty) {
      const byParty = await this.prisma.user.findFirst({
        where: { cantonPartyId: trimmed },
        select: { cantonPartyId: true, username: true },
      });
      partyId = byParty?.cantonPartyId ?? trimmed;
      username = byParty?.username ?? null;
    } else {
      const uname = trimmed.replace(/^@/, '').toLowerCase();
      const byName = await this.prisma.user.findFirst({
        where: { username: { equals: uname, mode: 'insensitive' } },
        select: { cantonPartyId: true, username: true },
      });
      username = byName?.username ?? uname;
      partyId = byName?.cantonPartyId ?? null;
    }

    if (!partyId || !hasRealWallet(partyId)) {
      return {
        input: trimmed,
        resolvedPartyId: partyId,
        resolvedUsername: username,
        hasWallet: false,
        authoritative: { active: false },
        sources: { ledgerReceiver: false, ledgerProvider: false, splice: null },
        spliceRest: { active: false },
      };
    }

    const spliceRest = await this.splice.getTransferPreapproval(partyId);
    const auth = await this.ledger.getTransferPreapprovalAuthoritative(
      partyId,
      {
        active: spliceRest !== null,
        expiresAt: spliceRest?.expiresAt,
        provider: spliceRest?.provider,
      },
    );

    this.logger.log(
      `debugPreapproval @${username ?? '?'} party=${partyId.split('::')[0]} ` +
        `authoritative.active=${auth.active} source=${auth.source ?? 'none'} ` +
        `ledgerReceiver=${auth.sources.ledgerReceiver} ` +
        `ledgerProvider=${auth.sources.ledgerProvider} ` +
        `splice=${auth.sources.splice}`,
    );

    return {
      input: trimmed,
      resolvedPartyId: partyId,
      resolvedUsername: username,
      hasWallet: true,
      authoritative: {
        active: auth.active,
        source: auth.source,
        expiresAt: auth.expiresAt,
        provider: auth.provider,
        contractId: auth.contractId,
      },
      sources: auth.sources,
      spliceRest: {
        active: spliceRest !== null,
        expiresAt: spliceRest?.expiresAt,
        provider: spliceRest?.provider,
      },
    };
  }
}
