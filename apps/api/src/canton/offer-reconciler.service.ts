import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
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
 *   Background poll (default 60s) cek row PENDING + transferInstructionCid di
 *   KEDUA tabel (CcTransaction untuk CC, TokenTransaction untuk USDCx/dll).
 *   Kalau cid sudah hilang dari on-chain (offer consumed):
 *     - Cek delta balance sender: turun = ACCEPT (asset pergi) → COMPLETED
 *     - Cek delta balance sender: naik/kembali = REJECT (asset kembali) → REJECTED
 *   Flip status + push realtime notif ke sender.
 *
 *   CC delta pakai getLedgerBalance (saldo Amulet).
 *   Token delta pakai queryTokenHoldings (saldo per-instrument).
 *
 * Idempoten: hanya proses row PENDING. Row sudah COMPLETED/REJECTED di-skip.
 */

/** Row PENDING generik — meng-cover CcTransaction + TokenTransaction. */
type ReconcileRow = {
  table: 'cc' | 'token';
  id: string;
  userId: string;
  transferInstructionCid: string;
  // CC-only (null untuk token):
  amountMicroCc: bigint | null;
  // Token-only (null untuk CC):
  amount: Decimal | null;
  instrumentId: string | null;
  instrumentAdmin: string | null;
  description: string;
};

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
   * Satu cycle reconcile. Cari semua row PENDING + cid (CC & token), cek on-chain,
   * flip kalau perlu. Idempoten — aman dipanggil berulang. Non-fatal: error satu
   * row tidak crash app.
   */
  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Scan KEDUA tabel PENDING dengan cid (offer yang belum settled).
      const [pendingCc, pendingToken] = await Promise.all([
        this.prisma.ccTransaction.findMany({
          where: {
            status: 'PENDING',
            transferInstructionCid: { not: null },
          },
          select: {
            id: true,
            userId: true,
            transferInstructionCid: true,
            amountMicroCc: true,
            description: true,
          },
          take: 50, // cap per cycle supaya tidak overload ledger API
        }),
        this.prisma.tokenTransaction.findMany({
          where: {
            status: 'PENDING',
            transferInstructionCid: { not: null },
          },
          select: {
            id: true,
            userId: true,
            transferInstructionCid: true,
            amount: true,
            instrumentId: true,
            instrumentAdmin: true,
            description: true,
          },
          take: 50,
        }),
      ]);

      // Merge jadi union ReconcileRow (filter null cid di runtime — TS tidak narrow
      // otomatis walau where not: null).
      const pendingRows: ReconcileRow[] = [];
      for (const r of pendingCc) {
        if (!r.transferInstructionCid) continue;
        pendingRows.push({
          table: 'cc',
          id: r.id,
          userId: r.userId,
          transferInstructionCid: r.transferInstructionCid,
          amountMicroCc: r.amountMicroCc,
          amount: null,
          instrumentId: null,
          instrumentAdmin: null,
          description: r.description,
        });
      }
      for (const r of pendingToken) {
        if (!r.transferInstructionCid) continue;
        pendingRows.push({
          table: 'token',
          id: r.id,
          userId: r.userId,
          transferInstructionCid: r.transferInstructionCid,
          amountMicroCc: null,
          amount: r.amount,
          instrumentId: r.instrumentId,
          instrumentAdmin: r.instrumentAdmin,
          description: r.description ?? '',
        });
      }

      if (pendingRows.length === 0) return;
      this.logger.debug(
        `Offer reconciler: checking ${pendingRows.length} pending offer(s)`,
      );

      // Group by userId supaya efisien (1 query on-chain per user, bukan per row).
      const byUser = new Map<string, ReconcileRow[]>();
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
   * Event-driven reconcile untuk SATU party (dipanggil CantonUpdatesService saat
   * stream mendeteksi perubahan). Lebih murah dari runOnce() — hanya proses user
   * yang punya partyId ini, skip scan seluruh DB.
   *
   * Idempoten + non-fatal: aman dipanggil berkali-kali, error tidak crash caller.
   * Returns true kalau ada offer yang di-settle (untuk monitoring).
   */
  async reconcileParty(partyId: string): Promise<boolean> {
    if (!partyId || partyId.startsWith('canquest:')) return false;
    try {
      // Resolve party → user.
      const user = await this.prisma.user.findFirst({
        where: { cantonPartyId: partyId },
        select: { id: true },
      });
      if (!user) return false; // party tidak punya user (mis. system wallet)

      const [pendingCcRaw, pendingTokenRaw] = await Promise.all([
        this.prisma.ccTransaction.findMany({
          where: {
            userId: user.id,
            status: 'PENDING',
            transferInstructionCid: { not: null },
          },
          select: {
            id: true,
            userId: true,
            transferInstructionCid: true,
            amountMicroCc: true,
            description: true,
          },
        }),
        this.prisma.tokenTransaction.findMany({
          where: {
            userId: user.id,
            status: 'PENDING',
            transferInstructionCid: { not: null },
          },
          select: {
            id: true,
            userId: true,
            transferInstructionCid: true,
            amount: true,
            instrumentId: true,
            instrumentAdmin: true,
            description: true,
          },
        }),
      ]);

      const pendingRows: ReconcileRow[] = [];
      for (const r of pendingCcRaw) {
        if (!r.transferInstructionCid) continue;
        pendingRows.push({
          table: 'cc',
          id: r.id,
          userId: r.userId,
          transferInstructionCid: r.transferInstructionCid,
          amountMicroCc: r.amountMicroCc,
          amount: null,
          instrumentId: null,
          instrumentAdmin: null,
          description: r.description,
        });
      }
      for (const r of pendingTokenRaw) {
        if (!r.transferInstructionCid) continue;
        pendingRows.push({
          table: 'token',
          id: r.id,
          userId: r.userId,
          transferInstructionCid: r.transferInstructionCid,
          amountMicroCc: null,
          amount: r.amount,
          instrumentId: r.instrumentId,
          instrumentAdmin: r.instrumentAdmin,
          description: r.description ?? '',
        });
      }
      if (pendingRows.length === 0) return false;

      const countBefore = pendingRows.length;
      await this.reconcileUser(user.id, pendingRows);
      // Re-check untuk lihat apakah ada yang berubah status (CC + token).
      const [afterCc, afterToken] = await Promise.all([
        this.prisma.ccTransaction.count({
          where: {
            userId: user.id,
            status: 'PENDING',
            transferInstructionCid: { not: null },
          },
        }),
        this.prisma.tokenTransaction.count({
          where: {
            userId: user.id,
            status: 'PENDING',
            transferInstructionCid: { not: null },
          },
        }),
      ]);
      return afterCc + afterToken < countBefore;
    } catch (err) {
      this.logger.warn(
        `Offer reconciler: reconcileParty(${partyId.slice(0, 12)}…) failed: ${String(err)}`,
      );
      return false;
    }
  }

  /**
   * Reconcile semua offer PENDING milik satu user (CC + token).
   * Query offer aktif on-chain 1x untuk sender party (mencakup CC & token),
   * lalu cek cid setiap row. Delta-detection berbeda per tabel:
   *   - CC: getLedgerBalance (saldo Amulet)
   *   - token: queryTokenHoldings per distinct instrumentId
   */
  private async reconcileUser(
    userId: string,
    rows: ReconcileRow[],
  ): Promise<void> {
    // Ambil partyId sender dari user.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { cantonPartyId: true, username: true },
    });
    if (!user?.cantonPartyId || user.cantonPartyId.startsWith('canquest:')) {
      return;
    }

    // Query offer aktif on-chain milik sender (1 call untuk semua cid, CC+token).
    // Direction HARUS 'outgoing' — kita lacak offer yang SENDER buat (menunggu
    // receiver accept/reject). Default 'incoming' akan return offer di mana sender
    // adalah RECEIVER (biasanya kosong) → semua cid salah dianggap hilang.
    const activeOffers = await this.ledger.queryPendingOffers(
      user.cantonPartyId,
      'outgoing',
    );
    const activeCids = new Set(activeOffers.map((o) => o.contractId));
    this.logger.debug(
      `Offer reconciler @${user.username}: ${rows.length} pending row(s) vs ` +
        `${activeOffers.length} active outgoing offer(s) on-chain`,
    );

    const ccRows = rows.filter((r) => r.table === 'cc');
    const tokenRows = rows.filter((r) => r.table === 'token');

    // ── CC path (existing logic) ──────────────────────────────────────────
    if (ccRows.length > 0) {
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

      for (const row of ccRows) {
        if (activeCids.has(row.transferInstructionCid)) continue; // belum settled
        await this.flipCcRow({
          row,
          username: user.username ?? '',
          balanceBefore,
          onChainBalance,
          userId,
        });
        // Balance berubah setelah row pertama di-flip → refresh agar row
        // berikutnya tidak pakai delta baseline yang basi.
        if (onChainBalance !== null) {
          try {
            onChainBalance = await this.ledger.getLedgerBalance(user.cantonPartyId);
          } catch {
            /* keep last known */
          }
        }
      }
    }

    // ── Token path (BARU) ─────────────────────────────────────────────────
    if (tokenRows.length > 0) {
      // Group by instrumentId+admin supaya 1 query on-chain per distinct token.
      const byInstrument = new Map<string, ReconcileRow[]>();
      for (const row of tokenRows) {
        const key = `${row.instrumentId ?? ''}::${row.instrumentAdmin ?? ''}`;
        const arr = byInstrument.get(key) ?? [];
        arr.push(row);
        byInstrument.set(key, arr);
      }

      for (const [, instrRows] of byInstrument) {
        const instrumentId = instrRows[0].instrumentId;
        const instrumentAdmin = instrRows[0].instrumentAdmin;
        if (!instrumentId || !instrumentAdmin) continue;

        // Snapshot before dari CantexTokenBalance (per userId+instrument).
        const balanceBefore = await this.prisma.cantexTokenBalance.findUnique({
          where: {
            userId_instrumentId_instrumentAdmin: {
              userId,
              instrumentId,
              instrumentAdmin,
            },
          },
          select: { balance: true },
        });

        // Refresh on-chain token holdings (posisi terkini post accept/reject).
        let onChainHoldings: number | null = null;
        try {
          const holdings = await this.ledger.queryTokenHoldings(
            user.cantonPartyId,
            instrumentId,
            instrumentAdmin,
          );
          onChainHoldings = holdings.reduce(
            (sum, h) => sum + Number(h.amount ?? '0'),
            0,
          );
        } catch (err) {
          this.logger.warn(
            `Offer reconciler: queryTokenHoldings failed for @${user.username} ${instrumentId}: ${String(err)}`,
          );
        }

        for (const row of instrRows) {
          if (activeCids.has(row.transferInstructionCid)) continue; // belum settled
          await this.flipTokenRow({
            row,
            username: user.username ?? '',
            instrumentId,
            instrumentAdmin,
            balanceBefore: balanceBefore?.balance ?? null,
            onChainHoldings,
            userId,
          });
          // Refresh holdings supaya row berikutnya pakai baseline segar.
          if (onChainHoldings !== null) {
            try {
              const holdings = await this.ledger.queryTokenHoldings(
                user.cantonPartyId,
                instrumentId,
                instrumentAdmin,
              );
              onChainHoldings = holdings.reduce(
                (sum, h) => sum + Number(h.amount ?? '0'),
                0,
              );
            } catch {
              /* keep last known */
            }
          }
        }
      }
    }
  }

  /** Flip satu CC row PENDING → COMPLETED/REJECTED via delta saldo Amulet. */
  private async flipCcRow(params: {
    row: ReconcileRow;
    username: string;
    balanceBefore: { balanceMicroCc: bigint } | null;
    onChainBalance: number | null;
    userId: string;
  }): Promise<void> {
    const { row, username, balanceBefore, onChainBalance, userId } = params;
    const cid = row.transferInstructionCid;
    const amountMicro = row.amountMicroCc ?? 0n;
    const amountCc = Number(amountMicro) / 1_000_000;

    // Bedakan via delta balance:
    //   - balance sender TURUN dari snapshot = ACCEPT (CC pergi ke receiver)
    //   - balance sender NAIK / tetap = REJECT (CC kembali / memang belum keluar)
    let newStatus: 'COMPLETED' | 'REJECTED';
    if (onChainBalance !== null && balanceBefore) {
      const beforeCc = Number(balanceBefore.balanceMicroCc) / 1_000_000;
      if (onChainBalance < beforeCc - amountCc * 0.5) {
        newStatus = 'COMPLETED';
      } else {
        newStatus = 'REJECTED';
      }
    } else {
      // BUG-H fix: FAIL-CLOSED. Sebelumnya fallback assume COMPLETED — berbahaya
      // karena bisa menandai offer yang sebenarnya di-reject sebagai COMPLETED
      // lalu push notif palsu "transaction:new {status:COMPLETED}" ke sender.
      // Sekarang: JANGAN flip. Biarkan PENDING, cycle reconciler berikutnya
      // akan retry bila saldo sudah bisa dibaca lagi.
      this.logger.warn(
        `Offer reconciler: balance unavailable for @${username} cid=${cid.slice(0, 16)}… — leaving PENDING (will retry next cycle)`,
      );
      return;
    }

    try {
      const settledAt = newStatus === 'COMPLETED' ? new Date() : null;
      await this.prisma.ccTransaction.update({
        where: { id: row.id },
        data: {
          status: newStatus,
          settledAt,
          description: row.description.replace(/\s*\[pending[^\]]*\]\s*/i, ''),
        },
      });
      this.logger.log(
        `Offer reconciler: cid=${cid.slice(0, 16)}… @${username} ` +
          `${amountCc} CC → ${newStatus} (settled externally)`,
      );

      // Update balance snapshot supaya konsisten.
      if (onChainBalance !== null) {
        const onChainMicro = BigInt(Math.round(onChainBalance * 1_000_000));
        await this.prisma.ccBalance
          .upsert({
            where: { userId },
            create: { userId, balanceMicroCc: onChainMicro },
            update: { balanceMicroCc: onChainMicro },
          })
          .catch(() => {});
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

  /** Flip satu token row PENDING → COMPLETED/REJECTED via delta saldo token. */
  private async flipTokenRow(params: {
    row: ReconcileRow;
    username: string;
    instrumentId: string;
    instrumentAdmin: string;
    balanceBefore: Decimal | null;
    onChainHoldings: number | null;
    userId: string;
  }): Promise<void> {
    const {
      row,
      username,
      instrumentId,
      instrumentAdmin,
      balanceBefore,
      onChainHoldings,
      userId,
    } = params;
    const cid = row.transferInstructionCid;
    const amountToken = row.amount ? Math.abs(Number(row.amount)) : 0;

    // Bedakan via delta holdings (mirror CC path):
    //   - holdings TURUN = ACCEPT (token pergi ke receiver) → COMPLETED
    //   - holdings NAIK / tetap = REJECT (token kembali) → REJECTED
    let newStatus: 'COMPLETED' | 'REJECTED';
    if (onChainHoldings !== null && balanceBefore) {
      const before = Number(balanceBefore);
      if (onChainHoldings < before - amountToken * 0.5) {
        newStatus = 'COMPLETED';
      } else {
        newStatus = 'REJECTED';
      }
    } else {
      // BUG-H fix: FAIL-CLOSED (mirror CC path). Sebelumnya fallback assume
      // COMPLETED → bisa menandai offer yang sebenarnya di-reject sebagai
      // COMPLETED + push notif palsu. Sekarang biarkan PENDING, retry next cycle.
      this.logger.warn(
        `Offer reconciler: token balance unavailable for @${username} ${instrumentId} cid=${cid.slice(0, 16)}… — leaving PENDING (will retry next cycle)`,
      );
      return;
    }

    try {
      const settledAt = newStatus === 'COMPLETED' ? new Date() : null;
      await this.prisma.tokenTransaction.update({
        where: { id: row.id },
        data: {
          status: newStatus,
          // TokenTransaction tidak punya kolom settledAt — status saja.
        },
      });
      this.logger.log(
        `Offer reconciler: cid=${cid.slice(0, 16)}… @${username} ` +
          `${amountToken} ${instrumentId} → ${newStatus} (settled externally)`,
      );

      // Update CantexTokenBalance snapshot supaya konsisten.
      if (onChainHoldings !== null && Number.isFinite(onChainHoldings)) {
        await this.prisma.cantexTokenBalance
          .upsert({
            where: {
              userId_instrumentId_instrumentAdmin: {
                userId,
                instrumentId,
                instrumentAdmin,
              },
            },
            create: {
              userId,
              instrumentId,
              instrumentAdmin,
              balance: onChainHoldings,
            },
            update: { balance: onChainHoldings },
          })
          .catch(() => {});
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
