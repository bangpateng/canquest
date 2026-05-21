import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SpliceValidatorService } from './splice-validator.service';

/**
 * Sync inbound CC from Splice wallet balance → CcTransaction (TRANSFER_IN).
 *
 * Canton on-chain balance is source of truth; this service detects increases and
 * records "CC received" in PostgreSQL so history works for:
 *   - Transfers from other CanQuest users (any API instance)
 *   - Validator / external Party IDs (preapproval or offer+accept)
 *
 * Per CIP-56, inbound CC may arrive via TransferPreapproval (direct) or
 * TransferOffer (accept) — both increase effective_unlocked_qty on Splice.
 */
@Injectable()
export class CcInboundSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CcInboundSyncService.name);
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly splice: SpliceValidatorService,
  ) {
    const flag = this.config.get<string>('CC_INBOUND_SYNC_ENABLED');
    this.enabled = flag === undefined || flag === '' || flag === 'true';
    this.pollIntervalMs = Number(
      this.config.get<string>('CC_INBOUND_SYNC_POLL_MS') ?? '30000',
    );
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.log('CC inbound sync disabled (CC_INBOUND_SYNC_ENABLED=false)');
      return;
    }
    if (!this.splice.isConfigured) {
      this.logger.warn('CC inbound sync skipped — Splice not configured');
      return;
    }
    this.logger.log(`CC inbound sync started (every ${this.pollIntervalMs}ms)`);
    void this.syncAllUsers();
    this.timer = setInterval(() => {
      void this.syncAllUsers();
    }, this.pollIntervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Update CcBalance snapshot from on-chain wallet without creating a transaction.
   * Call after Send CC / rewards already recorded TRANSFER_IN or OUT in DB.
   */
  async alignBalanceFromChain(userId: string, username: string): Promise<void> {
    if (!this.splice.isConfigured) return;
    const onChain = await this.splice.getUserBalance(username);
    if (onChain === null) return;
    const onChainMicro = BigInt(Math.round(onChain * 1_000_000));
    await this.prisma.ccBalance.upsert({
      where: { userId },
      create: { userId, balanceMicroCc: onChainMicro },
      update: { balanceMicroCc: onChainMicro },
    });
  }

  /** Sync one user (call before balance / transaction list). */
  async syncUser(userId: string, username: string, cantonPartyId?: string | null): Promise<void> {
    if (!this.enabled || !this.splice.isConfigured) return;
    if (!username || cantonPartyId?.startsWith('canquest:')) return;
    try {
      await this.syncUserBalance(userId, username);
    } catch (err) {
      this.logger.warn(`syncUser failed for @${username}: ${String(err)}`);
    }
  }

  private async syncAllUsers(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const users = await this.prisma.user.findMany({
        where: {
          username: { not: null },
          cantonPartyId: { not: null },
        },
        select: { id: true, username: true, cantonPartyId: true },
      });
      for (const u of users) {
        if (!u.username || !u.cantonPartyId || u.cantonPartyId.startsWith('canquest:')) {
          continue;
        }
        await this.syncUserBalance(u.id, u.username);
      }
    } finally {
      this.running = false;
    }
  }

  private async syncUserBalance(userId: string, username: string): Promise<void> {
    const onChain = await this.splice.getUserBalance(username);
    if (onChain === null) return;

    const onChainMicro = BigInt(Math.round(onChain * 1_000_000));
    const existing = await this.prisma.ccBalance.findUnique({ where: { userId } });

    if (!existing) {
      await this.prisma.ccBalance.create({
        data: { userId, balanceMicroCc: onChainMicro },
      });
      return;
    }

    if (onChainMicro > existing.balanceMicroCc) {
      const deltaMicro = onChainMicro - existing.balanceMicroCc;
      const deltaCc = Number(deltaMicro) / 1_000_000;
      const ledgerTxId = `inbound-sync:${userId}:${onChainMicro.toString()}`;

      const dup = await this.prisma.ccTransaction.findFirst({
        where: { ledgerTxId },
      });
      if (!dup) {
        await this.prisma.ccTransaction.create({
          data: {
            userId,
            amountMicroCc: deltaMicro,
            type: 'TRANSFER_IN',
            description: 'CC received',
            counterparty: 'Canton network',
            ledgerTxId,
            settledAt: new Date(),
          },
        });
        this.logger.log(
          `Recorded TRANSFER_IN ${deltaCc} CC for @${username} (balance sync)`,
        );
      }

      await this.prisma.ccBalance.update({
        where: { userId },
        data: { balanceMicroCc: onChainMicro },
      });
      return;
    }

    if (onChainMicro < existing.balanceMicroCc) {
      await this.prisma.ccBalance.update({
        where: { userId },
        data: { balanceMicroCc: onChainMicro },
      });
    }
  }
}
