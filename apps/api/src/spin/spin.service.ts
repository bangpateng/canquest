import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerQueueService } from '../queue/ledger-queue.service';
import { randomBytes } from 'crypto';

export interface SpinItemDto {
  id: string;
  label: string;
  rewardType: string;
  rewardCc: number;
  rewardPoints: number;
  probability: number;
  color: string;
  icon: string;
  inventory: number | null;
  wonCount: number;
}

export interface SpinResultDto {
  spinResultId: string;
  item: SpinItemDto;
  pointsSpent: number;
  jobId: string | null;
  message: string;
}

/** Biaya points per spin (dapat dioverride via env SPIN_COST_POINTS). */
const DEFAULT_SPIN_COST = 50;

@Injectable()
export class SpinService {
  private readonly logger = new Logger(SpinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerQueue: LedgerQueueService,
  ) {}

  // ── Admin: CRUD spin items ──────────────────────────────────────────────────

  async listItems(): Promise<SpinItemDto[]> {
    const items = await this.prisma.spinItem.findMany({
      where: { active: true },
      orderBy: { probability: 'desc' },
    });
    return items.map(this.toDto);
  }

  async listAllItems(): Promise<SpinItemDto[]> {
    const items = await this.prisma.spinItem.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return items.map(this.toDto);
  }

  async createItem(data: {
    label: string;
    rewardType: string;
    rewardCc?: number;
    rewardPoints?: number;
    probability: number;
    color?: string;
    icon?: string;
    inventory?: number | null;
  }): Promise<SpinItemDto> {
    await this.validateProbabilityBudget(data.probability);
    const item = await this.prisma.spinItem.create({
      data: {
        label: data.label,
        rewardType: data.rewardType,
        rewardCc: data.rewardCc ?? 0,
        rewardPoints: data.rewardPoints ?? 0,
        probability: data.probability,
        color: data.color ?? '#d4ff3f',
        icon: data.icon ?? 'gift',
        inventory: data.inventory ?? null,
      },
    });
    this.logger.log(`SpinItem created: ${item.label} (${item.probability}%)`);
    return this.toDto(item);
  }

  async updateItem(
    itemId: string,
    data: Partial<{
      label: string;
      rewardType: string;
      rewardCc: number;
      rewardPoints: number;
      probability: number;
      color: string;
      icon: string;
      inventory: number | null;
      active: boolean;
    }>,
  ): Promise<SpinItemDto> {
    const item = await this.prisma.spinItem.update({
      where: { id: itemId },
      data,
    });
    return this.toDto(item);
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.prisma.spinItem.delete({ where: { id: itemId } });
  }

  // ── User: Execute Spin ──────────────────────────────────────────────────────

  /**
   * Execute satu putaran spin untuk user.
   *
   * Flow:
   *   1. Validasi user punya cukup points
   *   2. Load active spin items
   *   3. Pilih winner dengan CSPRNG (backend RNG — tidak pernah frontend)
   *   4. Debit points user
   *   5. Simpan SpinResult ke DB
   *   6. Enqueue ke BullMQ jika reward = CC
   *   7. Return hasil ke user
   *
   * RNG menggunakan Node.js `randomBytes` (CSPRNG) untuk fairness & audit.
   */
  async executeSpin(
    userId: string,
    username: string | null,
    cantonPartyId: string | null,
  ): Promise<SpinResultDto> {
    const spinCost = Number(process.env.SPIN_COST_POINTS ?? DEFAULT_SPIN_COST);

    // Hitung total points user dari verified submissions
    const submissions = await this.prisma.questSubmission.findMany({
      where: { userId, status: 'VERIFIED' },
      include: { task: { select: { points: true } } },
    });
    const totalPoints = submissions.reduce((s, sub) => s + sub.task.points, 0);

    // Hitung points yang sudah dipakai spin
    const spentResults = await this.prisma.spinResult.findMany({
      where: { userId },
      select: { pointsSpent: true },
    });
    const spentPoints = spentResults.reduce((s, r) => s + r.pointsSpent, 0);
    const availablePoints = totalPoints - spentPoints;

    if (availablePoints < spinCost) {
      throw new BadRequestException(
        `Not enough points. You need ${spinCost} pts but have ${availablePoints} pts available.`,
      );
    }

    // Load active items
    const items = await this.prisma.spinItem.findMany({
      where: { active: true },
    });
    if (items.length === 0) {
      throw new BadRequestException('No spin items configured. Contact admin.');
    }

    // CSPRNG-based weighted random selection
    const winner = this.pickWinner(items);
    if (!winner) {
      throw new BadRequestException('Spin configuration error. Contact admin.');
    }

    // Cek inventory
    if (winner.inventory !== null && winner.wonCount >= winner.inventory) {
      const fallback = items.find((i) => i.rewardType === 'none') ?? items[0];
      if (!fallback) throw new BadRequestException('No fallback item available.');
      return this.saveAndEnqueue(userId, username, cantonPartyId, this.toDto(fallback), spinCost);
    }

    return this.saveAndEnqueue(userId, username, cantonPartyId, this.toDto(winner), spinCost);
  }

  private async saveAndEnqueue(
    userId: string,
    username: string | null,
    cantonPartyId: string | null,
    item: SpinItemDto,
    spinCost: number,
  ): Promise<SpinResultDto> {
    // Simpan hasil spin
    const result = await this.prisma.spinResult.create({
      data: {
        userId,
        spinItemId: item.id,
        pointsSpent: spinCost,
        delivered: item.rewardType === 'none' || item.rewardType === 'points',
        deliveredAt: (item.rewardType === 'none' || item.rewardType === 'points') ? new Date() : null,
      },
    });

    // Increment wonCount item
    await this.prisma.spinItem.update({
      where: { id: item.id },
      data: { wonCount: { increment: 1 } },
    });

    let jobId: string | null = null;

    // Enqueue CC delivery ke BullMQ
    if (item.rewardType === 'cc' && item.rewardCc > 0) {
      try {
        jobId = await this.ledgerQueue.enqueueSpinResult({
          spinResultId: result.id,
          userId,
          username,
          cantonPartyId,
          rewardType: item.rewardType,
          rewardCc: item.rewardCc,
        });
      } catch (err) {
        this.logger.warn(`Failed to enqueue spin CC delivery: ${String(err)}`);
      }
    }

    this.logger.log(
      `Spin: user=${userId.slice(0, 8)} won="${item.label}" type=${item.rewardType} ${item.rewardCc > 0 ? item.rewardCc + ' CC' : ''} jobId=${jobId ?? 'none'}`,
    );

    const message = this.buildMessage(item);
    return {
      spinResultId: result.id,
      item: this.toDto(item),
      pointsSpent: spinCost,
      jobId,
      message,
    };
  }

  // ── History ─────────────────────────────────────────────────────────────────

  async getUserHistory(userId: string, page = 1, pageSize = 10) {
    const skip = (page - 1) * pageSize;
    const [results, total] = await Promise.all([
      this.prisma.spinResult.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { spinItem: true },
      }),
      this.prisma.spinResult.count({ where: { userId } }),
    ]);
    return {
      items: results.map((r: typeof results[0]) => ({
        id: r.id,
        item: this.toDto(r.spinItem),
        pointsSpent: r.pointsSpent,
        delivered: r.delivered,
        ledgerTxId: r.ledgerTxId,
        createdAt: r.createdAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getAdminStats() {
    const [totalSpins, ccDelivered, pending] = await Promise.all([
      this.prisma.spinResult.count(),
      this.prisma.spinResult.count({ where: { delivered: true } }),
      this.prisma.spinResult.count({ where: { delivered: false } }),
    ]);
    return { totalSpins, ccDelivered, pending };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Weighted random selection menggunakan CSPRNG.
   * Menggunakan randomBytes(4) untuk mendapat angka random 32-bit
   * yang dibagi menjadi nilai 0–1 untuk pemilihan berbasis probabilitas kumulatif.
   */
  private pickWinner<T extends { probability: number }>(items: T[]): T | null {
    const total = items.reduce((s, i) => s + i.probability, 0);
    if (total <= 0) return null;

    // CSPRNG: 4 bytes = uint32, dibagi 0xFFFFFFFF untuk nilai 0.0–1.0
    const buf = randomBytes(4);
    const rand = buf.readUInt32BE(0) / 0xffffffff;
    const target = rand * total;

    let cumulative = 0;
    for (const item of items) {
      cumulative += item.probability;
      if (target <= cumulative) return item;
    }
    return items[items.length - 1] ?? null;
  }

  private async validateProbabilityBudget(newProbability: number): Promise<void> {
    const existing = await this.prisma.spinItem.aggregate({
      where: { active: true },
      _sum: { probability: true },
    });
    const currentTotal = existing._sum.probability ?? 0;
    if (currentTotal + newProbability > 100.01) {
      throw new BadRequestException(
        `Total probability would exceed 100%. Current: ${currentTotal.toFixed(1)}%, adding: ${newProbability}%`,
      );
    }
  }

  private buildMessage(item: { label: string; rewardType: string; rewardCc: number; rewardPoints: number }): string {
    switch (item.rewardType) {
      case 'cc':
        return `🎉 You won ${item.rewardCc} CC! It will arrive in your wallet shortly.`;
      case 'points':
        return `✨ You won ${item.rewardPoints} bonus points!`;
      case 'invite_code':
        return `🎟️ You won an invite code: ${item.label}`;
      case 'none':
      default:
        return `Better luck next time! You landed on "${item.label}".`;
    }
  }

  private toDto(item: {
    id: string;
    label: string;
    rewardType: string;
    rewardCc: number;
    rewardPoints: number;
    probability: number;
    color: string;
    icon: string;
    inventory: number | null;
    wonCount: number;
  }): SpinItemDto {
    return {
      id: item.id,
      label: item.label,
      rewardType: item.rewardType,
      rewardCc: item.rewardCc,
      rewardPoints: item.rewardPoints,
      probability: item.probability,
      color: item.color,
      icon: item.icon,
      inventory: item.inventory,
      wonCount: item.wonCount,
    };
  }
}
