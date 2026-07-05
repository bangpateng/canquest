import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * OfferReconcilerService — deteksi offer yang se-accept/REJECT di EXTERNAL wallet.
 *
 * PROBLEM:
 *   Saat receiver accept/reject offer via CanQuest sendiri, backend catat
 *   markTransferInstructionSettled → flip PENDING→COMPLETED/REJECTED.
 *   Tapi kalau receiver accept di EXTERNAL wallet (Splice wallet UI, dApp lain),
 *   backend CanQuest TIDAK tahu → row sender tetap PENDING forever.
 *
 * SOLUTION:
 *   Background poll (default 60s) cek row CcTransaction dengan status=PENDING +
 *   transferInstructionCid. Kalau cid sudah hilang dari on-chain (offer consumed):
 *     - Cek delta balance sender: turun = ACCEPT (CC pergi) → COMPLETED
 *     - Cek delta balance sender: naik/kembali = REJECT (CC kembali) → REJECTED
 *   Flip status + push realtime notif ke sender.
 *
 * Idempoten: hanya proses row PENDING. Row sudah COMPLETED/REJECTED di-skip.
 */
@Injectable()
export class OfferReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfferReconcilerService.name);
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ledger: CantonLedgerService,
    private readonly realtime: RealtimeService,
  ) {
    const flag = this.config.get<string>('OFFER_RECONCILER_ENABLED');
    this.enabled = flag === undefined || flag === '' || flag === 'true';
    this.pollIntervalMs = Number(
      this.config.get<string>('OFFER_RECONCILER_POLL_MS') ?? '60000',
    );
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Offer reconciler disabled (OFFER_RECONCILER_ENABLED=false)');
      return;
    }
    this.logger.log(`Offer reconciler started (every ${this.pollIntervalMs}ms)`);
    // Delay start supaya app stabil dulu saat boot (jangan rebut resource dgn startup lain).
    setTimeout(() => void this.runOnce(), 10_000);
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.pollIntervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Satu cycle reconcile. Cari semua row PENDING + cid, cek on-chain, flip kalau perlu.
   * Idempoten — aman dipanggil berulang. Non-fatal: error satu row tidak crash app.
   */
  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Cari semua row PENDING dengan transferInstructionCid (offer yang belum settled).
      const pendingRowsRaw = await this.prisma.ccTransaction.findMany({
        where: {
          status: 'PENDING',
          transferInstructionCid: { not: null },
        },
        select: {
          id: true,
          userId: true,
          transferInstructionCid: true,
          ledgerTxId: true,
          amountMicroCc: true,
          description: true,
        },
        take: 50, // cap per cycle supaya tidak overload ledger API
      });
      // Filter null di runtime (TS tidak narrow otomatis walau where not: null).
      const pendingRows = pendingRowsRaw.filter(
        (r): r is typeof r & { transferInstructionCid: string } =>
          !!r.transferInstructionCid,
      );

      if (pendingRows.length === 0) return;
      this.logger.debug(
        `Offer reconciler: checking ${pendingRows.length} pending offer(s)`,
      );

      // Group by userId supaya efisien (1 query on-chain per user, bukan per row).
      const byUser = new Map<string, typeof pendingRows>();
      for (const row of pendingRows) {
        const arr = byUser.get(row.userId) ?? [];
        arr.push(row);
        byUser.set(row.userId, arr);
      }

      for (const [userId, rows] of byUser) {
        try {
          await this.reconcileUser(userId, rows);
        } catch (err) {
          this.logger.warn(
            `Offer reconciler: user ${userId.slice(0, 8)} failed: ${String(err)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Reconcile semua offer PENDING milik satu user.
   * Query on-chain 1x untuk sender party, lalu cek cid setiap row.
   */
  private async reconcileUser(
    userId: string,
    rows: { id: string; userId: string; transferInstructionCid: string; ledgerTxId: string | null; amountMicroCc: bigint; description: string }[],
  ): Promise<void> {
    // Ambil partyId sender dari user.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { cantonPartyId: true, username: true },
    });
    if (!user?.cantonPartyId || user.cantonPartyId.startsWith('canquest:')) {
      return;
    }

    // Query offer aktif on-chain milik sender (1 call untuk semua cid).
    const activeOffers = await this.ledger.queryPendingOffers(user.cantonPartyId);
    const activeCids = new Set(activeOffers.map((o) => o.contractId));

    // Cek db balance SEBELUM reconcile — untuk deteksi delta (accept vs reject).
    const balanceBefore = await this.prisma.ccBalance.findUnique({
      where: { userId },
      select: { balanceMicroCc: true },
    });

    // Refresh on-chain balance supaya kita tau posisi terkini (post accept/reject).
    let onChainBalance: number | null = null;
    try {
      onChainBalance = await this.ledger.getLedgerBalance(user.cantonPartyId);
    } catch (err) {
      this.logger.warn(
        `Offer reconciler: getLedgerBalance failed for @${user.username}: ${String(err)}`,
      );
    }

    for (const row of rows) {
      const cid = row.transferInstructionCid;
      // Kalau cid MASIH ada di on-chain → offer belum settled → skip.
      if (activeCids.has(cid)) continue;

      // cid hilang → offer sudah consumed (accept atau reject di external wallet).
      // Bedakan via delta balance:
      //   - balance sender TURUN dari snapshot = ACCEPT (CC pergi ke receiver)
      //   - balance sender NAIK / tetap = REJECT (CC kembali / memang belum keluar)
      const amountCc = Number(row.amountMicroCc) / 1_000_000;
      const amountMicroAbs =
        row.amountMicroCc < 0n ? -row.amountMicroCc : row.amountMicroCc;
      let newStatus: 'COMPLETED' | 'REJECTED';

      if (onChainBalance !== null && balanceBefore) {
        const beforeCc = Number(balanceBefore.balanceMicroCc) / 1_000_000;
        // Hitung expected balance setelah accept = before - amount.
        // Kalau on-chain < before → CC keluar → accept.
        // Kalau on-chain >= before → CC kembali / tidak bergerak → reject.
        if (onChainBalance < beforeCc - amountCc * 0.5) {
          newStatus = 'COMPLETED';
        } else {
          newStatus = 'REJECTED';
        }
      } else {
        // Fallback kalau balance tidak bisa dibaca: asumsikan COMPLETED (lebih
        // umum). Sender bisa manual correct kalau salah via support.
        newStatus = 'COMPLETED';
        this.logger.warn(
          `Offer reconciler: balance unavailable for @${user.username} cid=${cid.slice(0, 16)}… — assuming COMPLETED (fallback)`,
        );
      }

      try {
        const settledAt = newStatus === 'COMPLETED' ? new Date() : null;
        await this.prisma.ccTransaction.update({
          where: { id: row.id },
          data: {
            status: newStatus,
            settledAt,
            description: row.description.replace(
              /\s*\[pending[^\]]*\]\s*/i,
              '',
            ),
          },
        });
        this.logger.log(
          `Offer reconciler: cid=${cid.slice(0, 16)}… @${user.username} ` +
            `${amountCc} CC → ${newStatus} (settled externally)`,
        );

        // Update balance snapshot supaya konsisten.
        if (onChainBalance !== null) {
          const onChainMicro = BigInt(Math.round(onChainBalance * 1_000_000));
          await this.prisma.ccBalance.upsert({
            where: { userId },
            create: { userId, balanceMicroCc: onChainMicro },
            update: { balanceMicroCc: onChainMicro },
          }).catch(() => {});
        }

        // Push notif real-time ke sender supaya UI update live.
        this.realtime.push(userId, 'transaction:new', { status: newStatus });
        if (newStatus === 'COMPLETED') {
          this.realtime.push(userId, 'balance:changed', null);
        }
      } catch (err) {
        this.logger.warn(
          `Offer reconciler: flip failed for cid=${cid.slice(0, 16)}… : ${String(err)}`,
        );
      }
    }
  }
}
