import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SpliceValidatorService } from './splice-validator.service';
import { CantonLedgerService } from './canton-ledger.service';

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
  /**
   * Flag untuk POLLER BACKGROUND (loop semua user setiap 30s). Pisah dari
   * on-demand methods (alignBalanceFromChain, syncUser) yang dipanggil
   * controller setelah send/swap/reward (14 call site) — itu tetap aktif
   * terlepas dari flag ini.
   *
   * Default true supaya backward-compat. Set 'false' kalau CantonUpdatesService
   * (event-driven /v2/updates stream) sudah jalan — hilangkan double-work.
   */
  private readonly pollEnabled: boolean;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly splice: SpliceValidatorService,
    private readonly ledger: CantonLedgerService,
    private readonly realtime: RealtimeService,
  ) {
    // CC_INBOUND_SYNC_ENABLED (legacy) tetap dipakai supaya existing env tidak
    // break. CC_INBOUND_SYNC_POLL_ENABLED (baru) lebih spesifik: kalau diset
    // false, poller off tapi on-demand methods tetap jalan.
    const legacyFlag = this.config.get<string>('CC_INBOUND_SYNC_ENABLED');
    const legacyEnabled =
      legacyFlag === undefined || legacyFlag === '' || legacyFlag === 'true';
    const pollFlag = this.config.get<string>('CC_INBOUND_SYNC_POLL_ENABLED');
    this.pollEnabled =
      pollFlag !== undefined && pollFlag !== ''
        ? pollFlag === 'true'
        : legacyEnabled;
    this.pollIntervalMs = Number(
      this.config.get<string>('CC_INBOUND_SYNC_POLL_MS') ?? '30000',
    );
  }

  onModuleInit() {
    if (!this.pollEnabled) {
      this.logger.log(
        'CC inbound sync POLLER disabled (CC_INBOUND_SYNC_POLL_ENABLED=false). On-demand methods still active.',
      );
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
  async alignBalanceFromChain(
    userId: string,
    username: string,
    cantonPartyId?: string | null,
  ): Promise<void> {
    if (!this.splice.isConfigured) return;
    const onChain =
      cantonPartyId && !cantonPartyId.startsWith('canquest:')
        ? await this.ledger.getLedgerBalance(cantonPartyId)
        : await this.splice.getUserBalance(username);
    if (onChain === null) return;
    const onChainMicro = BigInt(Math.round(onChain * 1_000_000));
    await this.prisma.ccBalance.upsert({
      where: { userId },
      create: { userId, balanceMicroCc: onChainMicro },
      update: { balanceMicroCc: onChainMicro },
    });
  }

  /**
   * Sync one user on-demand (dipanggil controller sebelum balance / transaction
   * list). TIDAK gated by pollEnabled — on-demand method ini independen dari
   * background poller, supaya send/swap/reward tetap sync walau poller off.
   */
  async syncUser(
    userId: string,
    username: string,
    cantonPartyId?: string | null,
  ): Promise<void> {
    if (!this.splice.isConfigured) return;
    if (!username || cantonPartyId?.startsWith('canquest:')) return;
    try {
      await this.syncUserBalance(userId, username, cantonPartyId);
    } catch (err) {
      this.logger.warn(`syncUser failed for @${username}: ${String(err)}`);
    }
  }

  /**
   * Event-driven reconcile untuk SATU party (dipanggil CantonUpdatesService saat
   * stream ledger mendeteksi perubahan balance/holding untuk party ini).
   *
   * Lebih murah dari syncAllUsers() (loop semua user) — hanya resolve party ini
   * → user, lalu syncUserBalance. Idempoten + non-fatal.
   *
   * Tidak gated by CC_INBOUND_SYNC_ENABLED: event-driven path ini INDEPENDEN
   * dari poller background. Tujuannya justru replace poller secara gradual.
   */
  async reconcileParty(partyId: string): Promise<void> {
    if (!partyId || partyId.startsWith('canquest:')) return;
    try {
      const user = await this.prisma.user.findFirst({
        where: { cantonPartyId: partyId },
        select: { id: true, username: true, cantonPartyId: true },
      });
      if (!user?.username) return; // party tidak punya user (system wallet)
      // syncUserBalance sudah handle realtime push + dedup heuristic.
      await this.syncUserBalance(user.id, user.username, user.cantonPartyId);
    } catch (err) {
      this.logger.warn(
        `reconcileParty(${partyId.slice(0, 12)}…) failed: ${String(err)}`,
      );
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
        if (
          !u.username ||
          !u.cantonPartyId ||
          u.cantonPartyId.startsWith('canquest:')
        ) {
          continue;
        }
        // Per-user try/catch: satu user gagal (auth 401 / network) TIDAK boleh
        // crash app atau menghentikan sync user lain.
        try {
          await this.syncUserBalance(u.id, u.username, u.cantonPartyId);
        } catch (err) {
          this.logger.warn(
            `syncAllUsers: syncUserBalance failed for @${u.username}: ${String(err)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Skip generic "CC received" when FCFS (or similar) already logged fee + reward lines.
   * Net on-chain delta (e.g. +17) must not appear as a third history row.
   */
  private async isExplainedByRecentAppActivity(
    userId: string,
    deltaMicro: bigint,
  ): Promise<boolean> {
    const since = new Date(Date.now() - 20 * 60_000);

    const exactReward = await this.prisma.ccTransaction.findFirst({
      where: {
        userId,
        type: 'QUEST_REWARD',
        amountMicroCc: deltaMicro,
        createdAt: { gte: since },
      },
    });
    if (exactReward) return true;

    const reward = await this.prisma.ccTransaction.findFirst({
      where: {
        userId,
        type: 'QUEST_REWARD',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!reward) return false;

    const fee = await this.prisma.ccTransaction.findFirst({
      where: {
        userId,
        type: 'TRANSFER_OUT',
        createdAt: { gte: since },
        description: { startsWith: 'Sent ' },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!fee) return false;

    // S12: TRANSFER_OUT schema mungkin menyimpan magnitude positif atau negatif.
    // Gunakan Math.abs agar robust terhadap kedua konvensi — delta on-chain selalu
    // positif, jadi: reward (selalu positif) - |fee| = net delta.
    const feeAbs =
      fee.amountMicroCc < 0n ? -fee.amountMicroCc : fee.amountMicroCc;
    const netMicro = reward.amountMicroCc - feeAbs;
    return netMicro === deltaMicro;
  }

  private async syncUserBalance(
    userId: string,
    username: string,
    cantonPartyId?: string | null,
  ): Promise<void> {
    // Pakai Ledger API (admin Keycloak token) jika ada partyId real
    const onChain =
      cantonPartyId && !cantonPartyId.startsWith('canquest:')
        ? await this.ledger.getLedgerBalance(cantonPartyId)
        : await this.splice.getUserBalance(username);
    if (onChain === null) return;

    const onChainMicro = BigInt(Math.round(onChain * 1_000_000));
    const existing = await this.prisma.ccBalance.findUnique({
      where: { userId },
    });

    if (!existing) {
      await this.prisma.ccBalance.create({
        data: { userId, balanceMicroCc: onChainMicro },
      });
      return;
    }

    if (onChainMicro > existing.balanceMicroCc) {
      const deltaMicro = onChainMicro - existing.balanceMicroCc;
      const deltaCc = Number(deltaMicro) / 1_000_000;
      if (await this.isExplainedByRecentAppActivity(userId, deltaMicro)) {
        await this.prisma.ccBalance.update({
          where: { userId },
          data: { balanceMicroCc: onChainMicro },
        });
        return;
      }

      // Transfer masuk asli terdeteksi (balance naik BUKAN dari aktivitas app).
      // FE sudah memakai DB sebagai single source of truth (merge on-chain
      // dihapus), jadi kita WAJIB catat baris TRANSFER_IN supaya received CC
      // muncul di history + notifikasi.
      //
      // Sumber balance API hanya memberi delta jumlah, BUKAN sender/CID asli.
      // Pakai ledgerTxId ter-marker "inbound-sync:{partyId}:{ts}" supaya jelas
      // ini row hasil sync (bukan tx explorer). cc-transaction-visibility.ts
      // sudah eksplisit TIDAK menyembunyikan baris inbound-sync.
      this.logger.log(
        `Balance +${deltaCc} CC for @${username} synced from chain → recording TRANSFER_IN`,
      );

      await this.prisma.ccBalance.update({
        where: { userId },
        data: { balanceMicroCc: onChainMicro },
      });

      try {
        await this.prisma.ccTransaction.create({
          data: {
            userId,
            amountMicroCc: deltaMicro,
            type: 'TRANSFER_IN',
            description: `Received ${deltaCc} CC (on-chain)`,
            // referenceId = party pemilik (counterparty tidak diketahui dari balance API).
            referenceId: cantonPartyId ?? username,
            ledgerTxId: `inbound-sync:${cantonPartyId ?? username}:${Date.now()}`,
            status: 'COMPLETED',
            settledAt: new Date(),
          },
        });
      } catch (err) {
        // Jangan gagalkan sync hanya karena insert row bermasalah (mis. race
        // duplikat). Balance sudah ter-update; history row opsional.
        this.logger.warn(
          `Failed to record inbound TRANSFER_IN for @${username}: ${String(err)}`,
        );
      }

      // Push realtime: balance naik + tx baru → FE refresh list & notifikasi.
      this.realtime.push(userId, 'balance:changed', null);
      this.realtime.push(userId, 'transaction:new', {
        type: 'TRANSFER_IN',
        source: 'onchain',
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
