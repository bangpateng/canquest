/**
 * BalanceEventHandler — WAVE 6 Phase 2: konsumsi WSS event untuk update
 * saldo user secara real-time (CC + token), TANPA query REST ACS.
 *
 * Background:
 *   REST `/v2/state/active-contracts` di participant kami return `[]` untuk
 *   semua party user (visibility issue). CcInboundSyncService poller gagal
 *   detect transfer masuk. Tapi WSS `/v2/updates` BERFUNGSI normal dan sudah
 *   terima event dengan semua metadata (CantonUpdatesService Phase 1 fix).
 *
 * Strategi:
 *   Subscribe ke CantonUpdatesService.updates$ Subject. Untuk setiap event:
 *   1. Untuk setiap `created` event Amulet (templateId berakhir ":Splice.Amulet:Amulet"):
 *      - Resolve owner party → userId via DB lookup
 *      - Increment CcBalance user (+ record TRANSFER_IN row bila belum ada)
 *      - Push realtime `balance:changed` + `transaction:new`
 *   2. Untuk setiap `archived` event Amulet (holding consumed):
 *      - Resolve owner → decrement CcBalance
 *      - Push realtime `balance:changed` (outflow detected)
 *   3. Untuk setiap `exercised` choice TransferInstruction_Accept:
 *      - Mark PENDING row COMPLETED via markTransferInstructionSettled
 *      - Push realtime `transaction:new` (handled by markTransferInstructionSettled)
 *
 * Idempotency:
 *   - ledgerTxId = updateId (per-event unique)
 *   - @@unique([userId, ledgerTxId]) di CcTransaction / TokenTransaction cegah duplikat
 *   - In-memory `processedUpdates` Set cegah reprocess same updateId (missed-dedup safety)
 *
 * Non-fatal:
 *   - Error satu event tidak crash handler. Wrap per-event try/catch.
 *   - Resolve party → user gagal (mis. system wallet) → skip, bukan error.
 *
 * Performance:
 *   - Events jarang (<1/s). O(n) parse per event, n = jumlah contracts di event.
 *   - DB lookup party → user di-cache (Map) supaya tidak query tiap event.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { UsersService } from '../users/users.service';
import type { CantonUpdateEvent } from './canton-updates.service';

/** Owner party → userId cache (di-refresh tiap 5 menit atau on miss). */
interface OwnerCacheEntry {
  userId: string;
  username: string | null;
  cachedAt: number;
}

const OWNER_CACHE_TTL_MS = 5 * 60_000;
/** Maks ukuran cache supaya tidak leak memory untuk party yg never resolve. */
const OWNER_CACHE_MAX = 500;

@Injectable()
export class BalanceEventHandlerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BalanceEventHandlerService.name);
  /** Subscription ke CantonUpdatesService.updates$ Subject. */
  private subscription: Subscription | null = null;
  /** Set updateId yang sudah diproses (idempotency safety, max 10k entries). */
  private readonly processedUpdates = new Set<string>();
  private static readonly PROCESSED_MAX = 10_000;
  /** Cache owner party → userId supaya tidak query DB tiap event. */
  private readonly ownerCache = new Map<string, OwnerCacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    // Subscription di-setup oleh CantonUpdatesService.setOnEventHandler()
    // karena CantonUpdatesService dependen pada BalanceEventHandler (circular
    // kalau kita inject CantonUpdatesService ke sini). Wiring di module.
    this.logger.log('BalanceEventHandler ready (will be wired to WSS stream).');
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /**
   * Dipanggil CantonUpdatesService untuk register subscription ke updates$.
   * Dipisah dari onModuleInit supaya tidak ada circular import — service ini
   * tidak import CantonUpdatesService, sebaliknya CantonUpdatesService inject
   * service ini dan panggil method ini di onModuleInit-nya.
   */
  attachSubscription(sub: Subscription): void {
    this.subscription = sub;
  }

  /**
   * Proses satu CantonUpdateEvent: parse created/archived/exercised events
   * untuk update balance + history user. Non-fatal.
   */
  async processEvent(ev: CantonUpdateEvent): Promise<void> {
    if (!ev.updateId) {
      // Event tanpa updateId (mis. OffsetCheckpoint) — tidak ada balance change.
      return;
    }

    // Idempotency: skip kalau updateId sudah pernah diproses.
    if (this.processedUpdates.has(ev.updateId)) {
      return;
    }
    this.markProcessed(ev.updateId);

    try {
      // ── 1. Created events: holding baru = balance NAIK ───────────────────
      for (const c of ev.created) {
        await this.handleCreatedEvent(c, ev.updateId);
      }

      // ── 2. Archived events: holding di-archive = balance TURUN ───────────
      for (const a of ev.archived) {
        await this.handleArchivedEvent(a, ev.updateId);
      }

      // ── 3. Exercised events: choice exercises (accept/reject offer, dll.) ──
      for (const ex of ev.exercised) {
        await this.handleExercisedEvent(ex, ev);
      }
    } catch (err) {
      // Error satu event tidak boleh crash handler. Log + lanjut.
      this.logger.warn(
        `BalanceEventHandler: processEvent failed for updateId=${ev.updateId.slice(0, 16)}…: ${String(err)}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Created event handlers (balance increase)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle CreatedEvent: kalau Amulet baru, increment owner CcBalance.
   * Kalau token non-CC (Holding burn-mint), increment CantexTokenBalance.
   */
  private async handleCreatedEvent(
    c: { contractId: string; templateId: string; createArgument: Record<string, unknown>; witnessParties?: string[] },
    updateId: string,
  ): Promise<void> {
    const template = c.templateId || '';

    // Amulet (CC) — extract amount + owner dari createArgument.
    if (template.includes(':Splice.Amulet:Amulet')) {
      await this.handleAmuletCreated(c, updateId);
      return;
    }

    // Token non-CC (Holding burn-mint V1) — extract instrument + amount + owner.
    if (template.includes(':Splice.Api.Token.HoldingV1:Holding')) {
      await this.handleTokenHoldingCreated(c, updateId);
      return;
    }

    // Template lain (TransferInstruction, LockedAmulet, TransferPreapproval,
    // AmuletRules, dll.) — tidak affect balance langsung. Skip.
  }

  /**
   * Amulet baru tercipta → CC masuk ke owner. Increment CcBalance + record
   * TRANSFER_IN row (idempotent via @@unique([userId, ledgerTxId])).
   */
  private async handleAmuletCreated(
    c: { contractId: string; templateId: string; createArgument: Record<string, unknown>; witnessParties?: string[] },
    updateId: string,
  ): Promise<void> {
    const args = c.createArgument ?? {};
    const ownerPartyId = typeof args.owner === 'string' ? args.owner : null;
    if (!ownerPartyId) {
      return; // Tidak ada owner — skip (bukan user holding).
    }

    // Extract amount (mirror queryAmuletHoldings logic, canton-ledger.service.ts:2323-2332).
    const amtObj = args.amount as Record<string, unknown> | undefined;
    const initialAmountStr =
      typeof amtObj?.initialAmount === 'string'
        ? amtObj.initialAmount
        : typeof amtObj?.amount === 'string'
          ? amtObj.amount
          : typeof args.amount === 'string'
            ? args.amount
            : null;
    if (!initialAmountStr) {
      return; // Tidak ada amount — skip.
    }
    const initialAmount = parseFloat(initialAmountStr);
    if (!Number.isFinite(initialAmount) || initialAmount <= 0) {
      return;
    }

    // Resolve owner → user.
    const user = await this.resolveUserByParty(ownerPartyId);
    if (!user) {
      // Owner bukan user Canquest (mis. system wallet: DSO, validator, fee).
      return;
    }

    const deltaMicroCc = BigInt(Math.round(initialAmount * 1_000_000));

    try {
      // Increment CcBalance (atomic upsert).
      await this.prisma.ccBalance.upsert({
        where: { userId: user.userId },
        create: { userId: user.userId, balanceMicroCc: deltaMicroCc },
        update: { balanceMicroCc: { increment: deltaMicroCc } },
      });
    } catch (err) {
      this.logger.warn(
        `BalanceEventHandler: CcBalance increment failed for user=${user.userId.slice(0, 8)}… amount=${initialAmount} CC: ${String(err)}`,
      );
      return;
    }

    // Record TRANSFER_IN row — idempotent via @@unique([userId, ledgerTxId]).
    // ledgerTxId = updateId supaya reconnect/re-deliver tidak bikin duplikat.
    try {
      await this.users.recordTransaction({
        userId: user.userId,
        amountCc: initialAmount,
        type: 'TRANSFER_IN',
        description: `Received ${initialAmount.toFixed(6)} CC (on-chain)`,
        referenceId: ownerPartyId,
        ledgerTxId: `wss:${updateId}`,
        cantonUpdateId: updateId,
        status: 'COMPLETED',
      });
      this.logger.log(
        `BalanceEventHandler: +${initialAmount} CC → @${user.username ?? user.userId.slice(0, 8)} (updateId=${updateId.slice(0, 16)}…)`,
      );
    } catch (err) {
      // P2002 (unique constraint) = row sudah ada (idempotent re-deliver) → OK.
      // Error lain = audit-trail loss, balance sudah update — log warn, lanjut.
      const errMsg = String(err);
      if (!errMsg.includes('P2002') && !errMsg.includes('Unique constraint')) {
        this.logger.warn(
          `BalanceEventHandler: TRANSFER_IN record failed for user=${user.userId.slice(0, 8)}… (balance already updated): ${errMsg}`,
        );
      }
    }

    // Push realtime ke user supaya frontend refresh wallet + activity.
    this.realtime.push(user.userId, 'balance:changed', null);
    this.realtime.push(user.userId, 'transaction:new', {
      type: 'TRANSFER_IN',
      source: 'wss',
    });
  }

  /**
   * Token holding (non-CC) baru tercipta → token masuk ke owner.
   * Update CantexTokenBalance supaya swapBalances endpoint (yang baca DB) reflect.
   */
  private async handleTokenHoldingCreated(
    c: { contractId: string; templateId: string; createArgument: Record<string, unknown>; witnessParties?: string[] },
    updateId: string,
  ): Promise<void> {
    const args = c.createArgument ?? {};
    const ownerPartyId = typeof args.owner === 'string' ? args.owner : null;
    if (!ownerPartyId) return;

    // Extract instrument + amount.
    const instrumentObj = args.instrument as Record<string, unknown> | undefined;
    const instrumentId =
      typeof instrumentObj?.id === 'string'
        ? instrumentObj.id
        : typeof args.instrumentId === 'string'
          ? args.instrumentId
          : null;
    const instrumentAdmin =
      typeof instrumentObj?.admin === 'string'
        ? instrumentObj.admin
        : typeof args.instrumentAdmin === 'string'
          ? args.instrumentAdmin
          : null;
    if (!instrumentId || !instrumentAdmin) return;

    const amountStr =
      typeof args.amount === 'string'
        ? args.amount
        : typeof (args.amount as Record<string, unknown> | undefined)?.amount === 'string'
          ? ((args.amount as Record<string, unknown>).amount as string)
          : null;
    if (!amountStr) return;
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) return;

    // Skip CC via token standard (CC pakai Splice.Amulet:Amulet, bukan Holding).
    if (instrumentId.toLowerCase() === 'amulet') return;

    const user = await this.resolveUserByParty(ownerPartyId);
    if (!user) return;

    try {
      await this.prisma.cantexTokenBalance.upsert({
        where: {
          userId_instrumentId_instrumentAdmin: {
            userId: user.userId,
            instrumentId,
            instrumentAdmin,
          },
        },
        create: {
          userId: user.userId,
          instrumentId,
          instrumentAdmin,
          balance: new Decimal(amount),
        },
        update: { balance: { increment: new Decimal(amount) } },
      });
      this.logger.log(
        `BalanceEventHandler: +${amount} ${instrumentId} → @${user.username ?? user.userId.slice(0, 8)}… (updateId=${updateId.slice(0, 16)}…)`,
      );
      // Push realtime supaya frontend refresh wallet.
      this.realtime.push(user.userId, 'balance:changed', null);
    } catch (err) {
      this.logger.warn(
        `BalanceEventHandler: CantexTokenBalance increment failed: ${String(err)}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Archived event handlers (balance decrease)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle ArchivedEvent: holding di-archive (consumed by transfer/lock/swap).
   * Untuk Amulet → decrement owner CcBalance (outflow detected).
   *
   * Catatan: kita tidak punya info amount + owner dari ArchivedEvent (cuma
   * contractId + templateId). Untuk dapat amount, kita perlu lookup contract
   * data yang sudah di-cache saat created. Karena kompleks, versi awal ini
   * HANYA push realtime `balance:changed` (frontend refetch), tanpa decrement
   * DB optimistic. Outflow akan ke-detect via 2 jalur:
   *   1. recordTransaction dari controller (sendCc/swap/lock) yang sudah jalan
   *   2. CcInboundSyncService polling (kalau enabled) yang baca ledger delta
   * Karena WSS-only (poller OFF), kita andalkan #1 untuk outflow tracking.
   */
  private async handleArchivedEvent(
    a: { contractId: string; templateId: string; witnessParties?: string[] },
    updateId: string,
  ): Promise<void> {
    const template = a.templateId || '';
    if (!template.includes(':Splice.Amulet:Amulet') && !template.includes(':Splice.Api.Token.HoldingV1:Holding')) {
      return;
    }

    // Witness parties = parties yang affected by archive. Push realtime ke
    // mereka supaya frontend refetch balance.
    const parties = a.witnessParties ?? [];
    for (const partyId of parties) {
      if (partyId.startsWith('canquest:')) continue;
      const user = await this.resolveUserByParty(partyId);
      if (user) {
        this.realtime.push(user.userId, 'balance:changed', null);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Exercised event handlers (choice exercises)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle ExercisedEvent: choice exercises seperti TransferInstruction_Accept,
   * TransferInstruction_Reject, LockedAmulet_OwnerExpireLockV2.
   *
   * Untuk accept/reject offer: kontrak TransferInstruction contractId di-archive
   * → kita bisa markTransferInstructionSettled untuk flip PENDING row di DB.
   * Tapi extract cid dari exercised.contractId cukup reliable karena itu
   * adalah contract TransferInstruction yang di-exercise.
   */
  private async handleExercisedEvent(
    ex: {
      contractId: string;
      templateId: string;
      choice: string;
      actingParties?: string[];
      witnessParties?: string[];
    },
    ev: CantonUpdateEvent,
  ): Promise<void> {
    const choice = ex.choice ?? '';

    // ── TransferInstruction_Accept / _Reject ─────────────────────────────
    // Choice di-exercise di kontrak TransferInstruction. contractId = cid
    // yang kita simpan di CcTransaction.transferInstructionCid (PENDING rows).
    // Saat choice Accept/Reject di-exercise, kontrak di-archive → flip PENDING.
    if (
      ex.templateId?.includes(':TransferInstruction') ||
      choice === 'TransferInstruction_Accept' ||
      choice === 'TransferInstruction_Reject' ||
      choice === 'TransferInstruction_Withdraw'
    ) {
      const cid = ex.contractId;
      const status: 'COMPLETED' | 'REJECTED' =
        choice === 'TransferInstruction_Reject'
          ? 'REJECTED'
          : choice === 'TransferInstruction_Withdraw'
            ? 'REJECTED' // Withdraw = sender tarik balik → treat as REJECTED dari sisi receiver.
            : 'COMPLETED'; // Accept = COMPLETED.

      try {
        const flipped = await this.users.markTransferInstructionSettled(
          cid,
          status,
          ev.updateId,
        );
        if (flipped > 0) {
          this.logger.log(
            `BalanceEventHandler: offer ${choice} cid=${cid.slice(0, 16)}… → ${status} (flipped ${flipped} row, updateId=${ev.updateId?.slice(0, 16)}…)`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `BalanceEventHandler: markTransferInstructionSettled failed for cid=${cid.slice(0, 16)}… ${status}: ${String(err)}`,
        );
      }
    }

    // Choice lain (TransferFactory_Transfer, LockedAmulet_*, AmuletRules_*)
    // tidak perlu handler khusus — efeknya sudah tertangkap oleh created/archived
    // child events (Amulet baru untuk receiver, Amulet lama di-archive).
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve owner party → user via DB. Cache 5 menit supaya tidak query tiap
   * event untuk party yg sama.
   */
  private async resolveUserByParty(
    partyId: string,
  ): Promise<{ userId: string; username: string | null } | null> {
    // Check cache.
    const cached = this.ownerCache.get(partyId);
    if (cached && Date.now() - cached.cachedAt < OWNER_CACHE_TTL_MS) {
      return cached.userId ? cached : null;
    }

    // Lookup DB. Party ID case-insensitive (Canton normalize).
    const user = await this.prisma.user.findFirst({
      where: { cantonPartyId: { equals: partyId, mode: 'insensitive' } },
      select: { id: true, username: true },
    });

    const entry: OwnerCacheEntry = {
      userId: user?.id ?? '',
      username: user?.username ?? null,
      cachedAt: Date.now(),
    };

    // Evict kalau cache mendekati max.
    if (this.ownerCache.size >= OWNER_CACHE_MAX) {
      const oldest = [...this.ownerCache.entries()].sort(
        (a, b) => a[1].cachedAt - b[1].cachedAt,
      )[0];
      if (oldest) this.ownerCache.delete(oldest[0]);
    }
    this.ownerCache.set(partyId, entry);

    return user ? { userId: user.id, username: user.username } : null;
  }

  /** Mark updateId sebagai sudah diproses (idempotency safety). */
  private markProcessed(updateId: string): void {
    this.processedUpdates.add(updateId);
    // Evict oldest kalau set mendekati max (FIFO approximation via insertion order).
    if (this.processedUpdates.size >= BalanceEventHandlerService.PROCESSED_MAX) {
      const first = this.processedUpdates.values().next().value;
      if (first) this.processedUpdates.delete(first);
    }
  }
}
