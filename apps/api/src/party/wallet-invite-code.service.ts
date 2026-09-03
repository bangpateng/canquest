import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Reservation expires after 30 minutes if wallet creation does not finish. */
const RESERVE_TTL_MS = 30 * 60 * 1000;

/**
 * sha256(plaintext) hex — SATU-SATUNYA kunci lookup & penyimpanan.
 * Plaintext tampil sekali saat generate (pola API key), tidak pernah
 * disimpan mentah (AGENT.md §invite code).
 */
export function hashCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

@Injectable()
export class WalletInviteCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  normalizeCode(raw: string): string {
    return raw.trim().replace(/\s+/g, '');
  }

  private get dailyLimit(): number {
    const n = Number(this.config.get<string>('WALLET_DAILY_ALLOCATION_LIMIT') ?? '50');
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
  }

  private reservationExpired(reservedAt: Date | null): boolean {
    if (!reservedAt) return true;
    return Date.now() - reservedAt.getTime() > RESERVE_TTL_MS;
  }

  /** User already completed wallet creation with an invite code. */
  async userHasRedeemedInvite(userId: string): Promise<boolean> {
    const count = await this.prisma.walletInviteCode.count({
      where: { redeemedById: userId, redeemedAt: { not: null } },
    });
    return count > 0;
  }

  /**
   * Hold code for this user while they create a wallet.
   * Does not mark the code as used — only blocks other users temporarily.
   */
  async reserveForWalletCreation(
    userId: string,
    walletInviteCode: string,
  ): Promise<void> {
    const normalized = this.normalizeCode(walletInviteCode);
    if (normalized.length < 4) {
      throw new BadRequestException({
        message: 'Wallet invite code is invalid.',
        code: 'WALLET_INVITE_INVALID',
      });
    }

    const row = await this.prisma.walletInviteCode.findUnique({
      where: { codeHash: hashCode(normalized) },
    });
    if (!row) {
      throw new BadRequestException({
        message: 'Wallet invite code not found.',
        code: 'WALLET_INVITE_INVALID',
      });
    }
    if (row.redeemedAt) {
      throw new BadRequestException({
        message: 'This wallet invite code has already been used.',
        code: 'WALLET_INVITE_USED',
      });
    }

    if (
      row.reservedById &&
      row.reservedById !== userId &&
      !this.reservationExpired(row.reservedAt)
    ) {
      throw new BadRequestException({
        message:
          'This wallet invite code is temporarily in use. Try again in a few minutes.',
        code: 'WALLET_INVITE_RESERVED',
      });
    }

    // UPDATE bersyarat — dua request paralel memperebutkan hold yang sama,
    // satu menang di DB (AGENT.md: jangan cek-lalu-tulis).
    const won = await this.prisma.walletInviteCode.updateMany({
      where: {
        codeHash: row.codeHash,
        redeemedAt: null,
        OR: [{ reservedById: null }, { reservedById: userId }],
      },
      data: { reservedById: userId, reservedAt: new Date() },
    });
    if (won.count === 0) {
      throw new BadRequestException({
        message: 'This wallet invite code is temporarily in use. Try again in a few minutes.',
        code: 'WALLET_INVITE_RESERVED',
      });
    }
  }

  /** Release a temporary hold (failed or placeholder wallet — code stays available). */
  async releaseReservation(
    userId: string,
    walletInviteCode?: string,
  ): Promise<void> {
    if (!walletInviteCode?.trim()) return;
    const normalized = this.normalizeCode(walletInviteCode);
    await this.prisma.walletInviteCode.updateMany({
      where: {
        codeHash: hashCode(normalized),
        redeemedAt: null,
        reservedById: userId,
      },
      data: { reservedById: null, reservedAt: null },
    });
  }

  /**
   * Before creating a wallet: reserve code unless this user already completed with one.
   */
  async assertCanCreateWallet(
    userId: string,
    walletInviteCode?: string,
  ): Promise<void> {
    if (await this.userHasRedeemedInvite(userId)) {
      return;
    }
    const raw = walletInviteCode?.trim();
    if (!raw) {
      throw new BadRequestException({
        message: 'A wallet invite code is required to create your wallet.',
        code: 'WALLET_INVITE_REQUIRED',
      });
    }
    await this.reserveForWalletCreation(userId, raw);
  }

  /**
   * Batas alokasi harian (default 50) — dihitung per TANGGAL (UTC) dari
   * WalletAllocationLog. Rate control, bukan security control
   * (SECURITY.md §invite codes) — cek sebelum redeem sudah memadai.
   */
  async assertDailyCapAvailable(): Promise<void> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await this.prisma.walletAllocationLog.count({
      where: { createdAt: { gte: startOfDay } },
    });
    if (used >= this.dailyLimit) {
      throw new BadRequestException({
        message: `Daily wallet allocation limit reached (${this.dailyLimit}/day). Try again tomorrow.`,
        code: 'WALLET_DAILY_CAP',
      });
    }
  }

  /**
   * Mark code as permanently used — only after a real (non-placeholder) wallet exists.
   * 1 code → 1 user forever. UPDATE BERSYARAT (rowcount 0 = sudah dipakai →
   * TOLAK) — race antar request kalah di database, bukan di kode aplikasi
   * (AGENT.md §invite code).
   */
  async redeemAfterWalletCreated(
    userId: string,
    walletInviteCode?: string,
  ): Promise<void> {
    if (await this.userHasRedeemedInvite(userId)) {
      return;
    }
    await this.assertDailyCapAvailable();
    const normalized = this.normalizeCode(walletInviteCode ?? '');
    const updated = await this.prisma.walletInviteCode.updateMany({
      where: {
        codeHash: hashCode(normalized),
        redeemedAt: null,
        OR: [{ reservedById: userId }, { reservedById: null }],
      },
      data: {
        redeemedAt: new Date(),
        redeemedById: userId,
        reservedById: null,
        reservedAt: null,
      },
    });
    if (updated.count === 0) {
      throw new BadRequestException({
        message: 'Wallet invite code is invalid or already used.',
        code: 'WALLET_INVITE_INVALID',
      });
    }
  }

  async recordAllocation(params: {
    userId: string;
    username?: string | null;
    partyId: string;
  }): Promise<void> {
    await this.prisma.walletAllocationLog.create({
      data: {
        userId: params.userId,
        username: params.username?.trim() || null,
        partyId: params.partyId,
      },
    });
  }
}
