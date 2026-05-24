import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CcInboundSyncService } from './cc-inbound-sync.service';
import { SpliceValidatorService } from './splice-validator.service';

export type BalanceDisplayResult = {
  balance: number | null;
  source: 'database' | 'chain' | 'unavailable';
  stale: boolean;
  updatedAt?: Date;
};

/**
 * Serves CC balance from PostgreSQL first, syncs Splice in the background.
 * Reduces load on the validator tunnel/VPN when users refresh the wallet page.
 */
@Injectable()
export class CcBalanceService {
  private readonly logger = new Logger(CcBalanceService.name);
  private readonly readFromDb: boolean;
  /** Return cached DB balance without blocking on Splice when younger than this. */
  private readonly dbMaxAgeMs: number;
  /** Minimum gap between background sync kicks for the same user. */
  private readonly backgroundDebounceMs: number;
  private readonly lastBackgroundKick = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly splice: SpliceValidatorService,
  ) {
    const flag = config.get<string>('BALANCE_READ_FROM_DB');
    this.readFromDb = flag === undefined || flag === '' || flag === 'true';
    this.dbMaxAgeMs = Number(config.get<string>('BALANCE_DB_MAX_AGE_MS') ?? '60000');
    this.backgroundDebounceMs = Number(
      config.get<string>('BALANCE_BACKGROUND_DEBOUNCE_MS') ?? '15000',
    );
  }

  microToCc(micro: bigint): number {
    return Number(micro) / 1_000_000;
  }

  /**
   * Fast path for GET /party/balance: DB first, optional background chain sync.
   */
  async getDisplayBalance(
    userId: string,
    username: string,
    cantonPartyId?: string | null,
  ): Promise<BalanceDisplayResult> {
    const row = await this.prisma.ccBalance.findUnique({ where: { userId } });

    if (this.readFromDb && row) {
      const ageMs = Date.now() - row.updatedAt.getTime();
      this.scheduleBackgroundSync(userId, username, cantonPartyId);

      if (ageMs <= this.dbMaxAgeMs) {
        return {
          balance: this.microToCc(row.balanceMicroCc),
          source: 'database',
          stale: false,
          updatedAt: row.updatedAt,
        };
      }

      return {
        balance: this.microToCc(row.balanceMicroCc),
        source: 'database',
        stale: true,
        updatedAt: row.updatedAt,
      };
    }

    return this.syncAndRead(userId, username, cantonPartyId);
  }

  /** Blocking sync when no DB row exists yet (first wallet load). */
  private async syncAndRead(
    userId: string,
    username: string,
    cantonPartyId?: string | null,
  ): Promise<BalanceDisplayResult> {
    await this.inboundSync.syncUser(userId, username, cantonPartyId);

    const row = await this.prisma.ccBalance.findUnique({ where: { userId } });
    if (row) {
      return {
        balance: this.microToCc(row.balanceMicroCc),
        source: 'database',
        stale: false,
        updatedAt: row.updatedAt,
      };
    }

    if (!this.splice.isConfigured) {
      return { balance: null, source: 'unavailable', stale: true };
    }

    const chain = await this.splice.getUserBalance(username);
    return {
      balance: chain,
      source: chain !== null ? 'chain' : 'unavailable',
      stale: false,
    };
  }

  private scheduleBackgroundSync(
    userId: string,
    username: string,
    cantonPartyId?: string | null,
  ): void {
    if (!username || cantonPartyId?.startsWith('canquest:')) return;

    const now = Date.now();
    const last = this.lastBackgroundKick.get(userId) ?? 0;
    if (now - last < this.backgroundDebounceMs) return;
    this.lastBackgroundKick.set(userId, now);

    void this.inboundSync.syncUser(userId, username, cantonPartyId).catch((err) => {
      this.logger.debug(`Background balance sync for ${userId}: ${String(err)}`);
    });
  }
}
