import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletInviteCodeService {
  constructor(private readonly prisma: PrismaService) {}

  normalizeCode(raw: string): string {
    return raw.trim().toUpperCase().replace(/\s+/g, '');
  }

  async userHasRedeemedInvite(userId: string): Promise<boolean> {
    const count = await this.prisma.walletInviteCode.count({
      where: { redeemedById: userId },
    });
    return count > 0;
  }

  /** Validates code is unused; does not consume. */
  async assertCodeAvailable(code: string): Promise<void> {
    const normalized = this.normalizeCode(code);
    if (normalized.length < 4) {
      throw new BadRequestException({
        message: 'Wallet invite code is invalid.',
        code: 'WALLET_INVITE_INVALID',
      });
    }
    const row = await this.prisma.walletInviteCode.findUnique({
      where: { code: normalized },
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
  }

  /**
   * Before creating a wallet: require a valid unused code unless this user already redeemed one
   * (retry after placeholder / reconnect).
   */
  async assertCanCreateWallet(userId: string, walletInviteCode?: string): Promise<void> {
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
    await this.assertCodeAvailable(raw);
  }

  /** Mark code as used after wallet was created successfully. */
  async redeemAfterWalletCreated(userId: string, walletInviteCode?: string): Promise<void> {
    if (await this.userHasRedeemedInvite(userId)) {
      return;
    }
    const normalized = this.normalizeCode(walletInviteCode ?? '');
    const updated = await this.prisma.walletInviteCode.updateMany({
      where: { code: normalized, redeemedAt: null },
      data: { redeemedAt: new Date(), redeemedById: userId },
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
