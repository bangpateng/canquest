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
  /**
   * Cache holding yang sudah di-create → dipakai saat archived event untuk
   * decrement balance sender. Key = contractId (unik per holding contract).
   *
   * Tanpa cache ini, archived event tidak tahu owner/amount/instrument (ArchivedEvent
   * cuma bawa contractId + templateId). CC punya reconciler poll fallback, TAPI
   * token (USDCx) TIDAK punya reconciler → cache ini WAJIB supaya sender balance
   * turun saat holding dikonsumsi (transfer/swap).
   *
   * Cache miss (handler restart antara create & archive) → push realtime refetch
   * aja (frontend refetch balance dari ledger via REST endpoint).
   */
  private readonly holdingCache = new Map<
    string,
    {
      userId: string;
      instrumentId: string;
      instrumentAdmin: string;
      amount: number;
      cachedAt: number;
    }
  >();
  private static readonly HOLDING_CACHE_MAX = 5_000;

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
   *
   * WAVE 6 DEDUP FIX: Canton sering split 1 transfer jadi multiple Amulet
   * UTXO (output + change). Setiap UTXO = created event terpisah. Kalau
   * handler proses masing-masing event individual → saldo over-counted +
   * notifikasi badge berlipat (mis. +4.22, +49.98, +54.20 padahal
   * seharusnya hanya +54.20 saja).
   *
   * FIX: aggregate SEMUA created Amulet dalam 1 transaksi (1 updateId),
   * group by owner party, lalu apply 1 increment + 1 notifikasi per user.
   * Dedup via @@unique([userId, ledgerTxId]) + skip kalau transaksi ini
   * sudah dicatat controller (swap/sendCc) — cek CcTransaction ledgerTxId.
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
      // ── 1. AGGREGATE created Amulet events per owner ─────────────────────
      // Sum semua initialAmount Amulet yang owner-nya sama dalam 1 updateId.
      // Lalu apply 1x increment per user (bukan per event).
      const ccByOwner = new Map<string, number>(); // partyId → totalAmount
      const tokenByOwnerKey = new Map<string, {
        userId: string;
        username: string | null;
        instrumentId: string;
        instrumentAdmin: string;
        amount: number;
        /** Contract IDs yang menyumbang ke agregat ini (untuk isi holding cache). */
        contractIds: string[];
      }>();

      for (const c of ev.created) {
        const template = c.templateId || '';
        if (template.includes(':Splice.Amulet:Amulet')) {
          const args = c.createArgument ?? {};
          const ownerPartyId = typeof args.owner === 'string' ? args.owner : null;
          if (!ownerPartyId) continue;
          const amtObj = args.amount as Record<string, unknown> | undefined;
          const amountStr =
            typeof amtObj?.initialAmount === 'string'
              ? amtObj.initialAmount
              : typeof amtObj?.amount === 'string'
                ? amtObj.amount
                : typeof args.amount === 'string'
                  ? args.amount
                  : null;
          if (!amountStr) continue;
          const amount = parseFloat(amountStr);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          ccByOwner.set(ownerPartyId, (ccByOwner.get(ownerPartyId) ?? 0) + amount);
        } else if (this.isTokenHoldingTemplate(template)) {
          // Token non-CC (mis. USDCx = `Utility.Registry.Holding.V0.Holding:Holding`)
          // — aggregate by owner+instrument.
          //
          // BUG SEBELUMNYA: match pakai `includes(':HoldingV1:Holding')` dll. Mainnet
          // pakai format `Utility.Registry.Holding.V0.Holding:Holding` — char pemisah
          // sebelum "Holding:Holding" adalah TITIK (.), bukan titik dua (:). Itu
          // sebabnya ketiga kondisi includes() LAMA gagal → USDCx holding event masuk
          // WSS tapi branch token tidak pernah dieksekusi → balance stuck di 0.
          // Fix: pakai isTokenHoldingTemplate() (endsWith `:Holding:Holding`).
          await this.handleTokenHoldingCreated(c, ev, tokenByOwnerKey);
        }
      }

      // ── 2. Apply CC increment per owner (1x per user per updateId) ───────
      for (const [ownerPartyId, totalAmount] of ccByOwner) {
        await this.applyCcIncrement(ownerPartyId, totalAmount, ev.updateId);
      }

      // ── 3. Apply token increment per owner+instrument ────────────────────
      for (const tk of tokenByOwnerKey.values()) {
        await this.applyTokenIncrement(tk, ev.updateId);
      }

      // ── 4. Archived events: holding di-archive = balance TURUN ───────────
      // Archive event cuma push realtime (outflow tracking via controller-side
      // recordTransaction di sendCc/swap/lock). Tidak decrement DB optimistic.
      for (const a of ev.archived) {
        await this.handleArchivedEvent(a);
      }

      // ── 5. Exercised events: choice exercises (accept/reject offer) ──────
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

  /**
   * Apply aggregated CC increment untuk 1 owner di 1 transaksi.
   *
   * Anti double-count HANYA untuk HISTORY ROW + NOTIFIKASI (BUKAN balance):
   * - Controller (sendCc, swap, lock, acceptOffer) catat history row + push notif.
   * - Controller TIDAK selalu increment CcBalance (mis. acceptOffer CC, atau
   *   transfer dari external wallet yg controller tidak aware).
   * - Handler WAJIB increment CcBalance setiap event (single source of truth
   *   saldo = WSS event). Hanya insert history + push notif yang skip kalau
   *   controller sudah catat (cegah duplikat row + duplikat badge).
   */
  private async applyCcIncrement(
    ownerPartyId: string,
    totalAmount: number,
    updateId: string,
  ): Promise<void> {
    const user = await this.resolveUserByParty(ownerPartyId);
    if (!user) {
      // Owner bukan user Canquest (DSO, validator, fee, Cantex trading account).
      return;
    }

    // STEP 1: SELALU increment CcBalance (single source of truth = WSS event).
    // Controller TIDAK reliable update CcBalance — handler WAJIB lakukan ini
    // supaya saldo user real-time akurat (mis. transfer dari external wallet,
    // swap delivery, accept offer USDCx — semua butuh increment dari handler).
    const deltaMicroCc = BigInt(Math.round(totalAmount * 1_000_000));
    try {
      await this.prisma.ccBalance.upsert({
        where: { userId: user.userId },
        create: { userId: user.userId, balanceMicroCc: deltaMicroCc },
        update: { balanceMicroCc: { increment: deltaMicroCc } },
      });
      this.logger.log(
        `BalanceEventHandler: CcBalance +${totalAmount.toFixed(6)} CC → @${user.username ?? user.userId.slice(0, 8)} (updateId=${updateId.slice(0, 16)}…)`,
      );
      // Push realtime balance:changed (UI refresh wallet).
      this.realtime.push(user.userId, 'balance:changed', null);
    } catch (err) {
      this.logger.warn(
        `BalanceEventHandler: CcBalance increment failed for user=${user.userId.slice(0, 8)}… amount=${totalAmount} CC: ${String(err)}`,
      );
      return;
    }

    // STEP 2: Cek apakah controller sudah catat history row (anti duplikat row).
    // Skip insert + skip push transaction:new (anti duplikat badge notif).
    // TETAP push balance:changed di atas (sudah dilakukan di STEP 1).
    const existing = await this.prisma.ccTransaction.findFirst({
      where: {
        userId: user.userId,
        OR: [
          { ledgerTxId: updateId },
          { ledgerTxId: `wss:${updateId}` },
          { cantonUpdateId: updateId },
        ],
      },
      select: { id: true, type: true },
    });
    if (existing) {
      // Controller sudah catat (SWAP_IN / TRANSFER_IN / TOKEN_TRANSFER_IN).
      // Skip insert history + skip push transaction:new (anti duplikat badge).
      // Balance increment di STEP 1 tetap jalan (itu wajib).
      this.logger.debug(
        `BalanceEventHandler: skip history insert CC +${totalAmount} untuk @${user.username ?? user.userId.slice(0, 8)} (tx sudah dicatat sebagai ${existing.type}, updateId=${updateId.slice(0, 16)}…)`,
      );
      return;
    }

    // STEP 3: Insert history row TRANSFER_IN (kalau controller belum catat).
    // Idempotent via @@unique([userId, ledgerTxId]).
    try {
      await this.users.recordTransaction({
        userId: user.userId,
        amountCc: totalAmount,
        type: 'TRANSFER_IN',
        description: `Received ${totalAmount.toFixed(6)} CC (on-chain)`,
        referenceId: ownerPartyId,
        ledgerTxId: `wss:${updateId}`,
        cantonUpdateId: updateId,
        status: 'COMPLETED',
      });
      this.logger.log(
        `BalanceEventHandler: +${totalAmount.toFixed(6)} CC → @${user.username ?? user.userId.slice(0, 8)} (updateId=${updateId.slice(0, 16)}…)`,
      );
    } catch (err) {
      const errMsg = String(err);
      if (!errMsg.includes('P2002') && !errMsg.includes('Unique constraint')) {
        this.logger.warn(
          `BalanceEventHandler: TRANSFER_IN record failed (balance already updated): ${errMsg}`,
        );
      }
    }

    // 1x push notif per user per transaksi (BUKAN per event).
    this.realtime.push(user.userId, 'balance:changed', null);
    this.realtime.push(user.userId, 'transaction:new', {
      type: 'TRANSFER_IN',
      source: 'wss',
    });
  }

  /**
   * Apply aggregated token increment untuk 1 owner+instrument di 1 transaksi.
   *
   * Juga isi holdingCache untuk setiap contractId, supaya saat archived event
   * nanti kita bisa decrement balance sender (CC ada reconciler fallback,
   * tapi token TIDAK — cache ini satu-satunya sumber info untuk decrement).
   */
  private async applyTokenIncrement(
    tk: {
      userId: string;
      username: string | null;
      instrumentId: string;
      instrumentAdmin: string;
      amount: number;
      contractIds: string[];
    },
    updateId: string,
  ): Promise<void> {
    // STEP 1: SELALU increment CantexTokenBalance (single source of truth = WSS event).
    // Controller (acceptOffer, sendToken) catat history row TAPI tidak increment
    // CantexTokenBalance → handler WAJIB lakukan ini supaya saldo token user
    // real-time akurat (kasus: accept offer USDCx → badge naik tapi saldo 0).
    try {
      // Case-insensitive lookup (sudah fix Phase 3).
      const row = await this.prisma.cantexTokenBalance.findFirst({
        where: {
          userId: tk.userId,
          instrumentId: { equals: tk.instrumentId, mode: 'insensitive' },
          instrumentAdmin: { equals: tk.instrumentAdmin, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (row) {
        await this.prisma.cantexTokenBalance.update({
          where: { id: row.id },
          data: { balance: { increment: new Decimal(tk.amount) } },
        });
      } else {
        await this.prisma.cantexTokenBalance.create({
          data: {
            userId: tk.userId,
            instrumentId: tk.instrumentId,
            instrumentAdmin: tk.instrumentAdmin,
            balance: new Decimal(tk.amount),
          },
        });
      }
      this.logger.log(
        `BalanceEventHandler: CantexTokenBalance +${tk.amount} ${tk.instrumentId} → @${tk.username ?? tk.userId.slice(0, 8)}… (updateId=${updateId.slice(0, 16)}…)`,
      );
      // Push realtime balance:changed (UI refresh wallet).
      this.realtime.push(tk.userId, 'balance:changed', null);

      // Isi holdingCache untuk setiap contractId. Saat holding ini di-archive
      // nanti (transfer keluar / swap / burn), kita bisa decrement balance
      // user dengan info owner+instrument+amount yang sama persis.
      for (const cid of tk.contractIds) {
        this.putHoldingCache(cid, {
          userId: tk.userId,
          instrumentId: tk.instrumentId,
          instrumentAdmin: tk.instrumentAdmin,
          amount: tk.amount,
        });
      }
    } catch (err) {
      this.logger.warn(
        `BalanceEventHandler: CantexTokenBalance increment failed for ${tk.instrumentId}: ${String(err)}`,
      );
      return;
    }

    // STEP 2: Cek apakah controller sudah catat history row (anti duplikat badge).
    // Skip push transaction:new (anti duplikat badge notif) — controller sudah push.
    // Balance increment di STEP 1 tetap jalan (wajib).
    const existing = await this.prisma.tokenTransaction.findFirst({
      where: {
        userId: tk.userId,
        OR: [
          { ledgerTxId: updateId },
          { ledgerTxId: `wss:${updateId}` },
          { cantonUpdateId: updateId },
        ],
      },
      select: { id: true, type: true },
    });
    if (existing) {
      this.logger.debug(
        `BalanceEventHandler: skip history insert ${tk.instrumentId} +${tk.amount} untuk @${tk.username ?? tk.userId.slice(0, 8)} (tx sudah dicatat sebagai ${existing.type}, updateId=${updateId.slice(0, 16)}…)`,
      );
      return;
    }

    // STEP 3: Kalau controller belum catat, skip history insert untuk token
    // (TokenTransaction di-handle controller via recordTokenTransaction).
    // Token history row tidak di-insert oleh handler untuk hindari kompleksitas
    // cross-table dedup — controller (acceptOffer/sendToken) sudah reliable.
    this.logger.debug(
      `BalanceEventHandler: token history untuk ${tk.instrumentId} +${tk.amount} tidak di-insert handler (controller akan handle)`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Token Holding helpers (USDCx & non-CC tokens)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cek apakah templateId = token Holding (bukan CC/Amulet).
   *
   * Mainnet Splice utility-registry holding: `…Utility.Registry.Holding.V0.Holding:Holding`
   * (terverifikasi dari WSS log produksi). Cabang match LAMA pakai
   * `includes(':HoldingV1:Holding')` dll. GAGAL karena:
   *   - mainnet pakai `Holding.V0` (titik) bukan `HoldingV1`
   *   - separator sebelum `Holding:Holding` di mainnet adalah TITIK (`...Holding:Holding`),
   *     bukan titik dua (`:Holding:Holding`)
   *
   * Match strategy: `endsWith(':Holding:Holding')`. Ini robust terhadap prefix
   * hash package apapun (mis. `#splice-api-token-holding-v1:...`) dan semua
   * varian versi (V0/V1/V2). CC/Amulet tidak diakhiri string ini → aman.
   */
  private isTokenHoldingTemplate(templateId: string): boolean {
    const t = templateId || '';
    // Mainnet utility-registry holding (USDCx): `…Utility.Registry.Holding.V0.Holding:Holding`
    if (t.endsWith(':Holding:Holding')) return true;
    // Varian lama / alternatif (defensive).
    if (t.includes(':HoldingV1:Holding') || t.includes(':HoldingV0:Holding')) return true;
    return false;
  }

  /**
   * Proses satu created token-Holding event: extract owner + instrument + amount
   * pakai field shape yang SAMA dengan `CantonLedgerService.queryTokenHoldings`
   * (yang sudah proven baca USDCx dari REST ACS). Lalu aggregate ke tokenByOwnerKey.
   *
   * Owner resolution (multi-source, urut dari paling akurat):
   *   1. createArgument.owner / .receiver / .holder / .account / .party
   *   2. c.signatories (signatory[0] biasanya owner)
   *   3. c.witnessParties
   *   4. ev.parties[] (top-level routing parties)
   *
   * BUG LAMA: fallback ev.parties[] skip party yg diawali `auth0_`. Tapi
   * `auth0_<keycloakSub>` JUSTRU format keycloakSub user Canquest → resolve gagal.
   * Fix: coba resolve SEMUA party non-system, jangan skip auth0_.
   */
  private async handleTokenHoldingCreated(
    c: { contractId: string; templateId: string; createArgument?: Record<string, unknown>; signatories?: string[]; witnessParties?: string[] },
    ev: CantonUpdateEvent,
    tokenByOwnerKey: Map<string, {
      userId: string;
      username: string | null;
      instrumentId: string;
      instrumentAdmin: string;
      amount: number;
      contractIds: string[];
    }>,
  ): Promise<void> {
    const args = c.createArgument ?? {};
    const cid = c.contractId;

    // ── Owner resolution (multi-source) ───────────────────────────────────
    const ownerFromArgs = this.extractTokenOwnerParty(args);
    let resolvedUser: { userId: string; username: string | null } | null = null;
    let resolvedParty: string | null = ownerFromArgs;

    if (resolvedParty) {
      resolvedUser = await this.resolveUserByParty(resolvedParty);
    }
    // Fallback: signatories → witnessParties → ev.parties[].
    if (!resolvedUser) {
      const candidates = [
        ...(c.signatories ?? []),
        ...(c.witnessParties ?? []),
        ...ev.parties,
      ];
      for (const p of candidates) {
        if (!p || this.isSystemParty(p)) continue;
        const u = await this.resolveUserByParty(p);
        if (u) {
          resolvedUser = u;
          resolvedParty = p;
          break;
        }
      }
    }
    if (!resolvedUser) {
      const ownerField = ownerFromArgs ?? '(none)';
      this.logger.warn(
        `BalanceEventHandler: Holding created tapi owner tidak resolve ke user Canquest. ` +
          `ownerField=${ownerField.split('::')[0]} createKeys=[${Object.keys(args).join(',')}] ` +
          `signatories=[${(c.signatories ?? []).slice(0, 2).map((p) => p.split('::')[0]).join(',')}] ` +
          `eventParties=[${ev.parties.slice(0, 4).map((p) => p.split('::')[0]).join(',')}]`,
      );
      return;
    }

    // ── Instrument resolution (mirror REST queryTokenHoldings field shapes) ──
    const { instrumentId, instrumentAdmin } = this.extractTokenInstrument(args);
    if (!instrumentId || !instrumentAdmin) {
      this.logger.warn(
        `BalanceEventHandler: Holding created tapi instrument tidak ketemu. ` +
          `owner=${(resolvedParty ?? '').split('::')[0]} createKeys=[${Object.keys(args).join(',')}]`,
      );
      return;
    }
    if (instrumentId.toLowerCase() === 'amulet') return; // CC, bukan token

    // ── Amount resolution ─────────────────────────────────────────────────
    const amountStr = this.extractTokenAmount(args);
    if (!amountStr) {
      this.logger.warn(
        `BalanceEventHandler: Holding created tapi amount tidak ketemu. ` +
          `owner=${(resolvedParty ?? '').split('::')[0]} instrument=${instrumentId} createKeys=[${Object.keys(args).join(',')}]`,
      );
      return;
    }
    const amount = parseFloat(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) return;

    // ── Aggregate by owner+instrument ─────────────────────────────────────
    const key = `${resolvedUser.userId}|${instrumentId.toLowerCase()}|${instrumentAdmin.toLowerCase()}`;
    const existing = tokenByOwnerKey.get(key);
    if (existing) {
      existing.amount += amount;
      existing.contractIds.push(cid);
    } else {
      tokenByOwnerKey.set(key, {
        userId: resolvedUser.userId,
        username: resolvedUser.username,
        instrumentId,
        instrumentAdmin,
        amount,
        contractIds: [cid],
      });
    }
  }

  /**
   * Extract owner party dari createArgument token Holding. Coba urutan field:
   *   owner → receiver → holder → account → party → transfer.receiver → transfer.sender
   */
  private extractTokenOwnerParty(args: Record<string, unknown>): string | null {
    if (typeof args.owner === 'string') return args.owner;
    if (typeof args.receiver === 'string') return args.receiver;
    if (typeof args.holder === 'string') return args.holder;
    if (typeof args.account === 'string') return args.account;
    if (typeof args.party === 'string') return args.party;
    // TransferOffer shape: nested di args.transfer.{sender,receiver}.
    const transfer = args.transfer as
      | { receiver?: string; sender?: string }
      | undefined;
    if (transfer) {
      if (typeof transfer.receiver === 'string') return transfer.receiver;
      if (typeof transfer.sender === 'string') return transfer.sender;
    }
    return null;
  }

  /**
   * Extract instrument { id, admin } dari createArgument token Holding.
   *
   * Field shape mirror `CantonLedgerService.queryTokenHoldings` (sudah proven
   * baca USDCx dari REST ACS di produksi). Beberapa varian:
   *   - args.instrument = { id, admin }           (CC/Amulet style)
   *   - args.instrument = { id, source }          (USDCx: source = admin party)
   *   - args.instrument = { urn }                 (URN parse → id)
   *   - args.instrumentId = { id, admin }         (registry-app style)
   *   - args.instrumentId = "..." + args.registrar = "..."  (USDCx registrar)
   */
  private extractTokenInstrument(
    args: Record<string, unknown>,
  ): { instrumentId: string; instrumentAdmin: string } {
    let instId = '';
    let instAdmin = '';

    // Shape 1: nested args.instrument = { id, admin, source, urn, token }
    const instNested = args.instrument as
      | { id?: string; admin?: string; source?: string; urn?: string; token?: string }
      | undefined;
    if (instNested) {
      if (instNested.id) instId = instNested.id;
      if (instNested.admin) instAdmin = instNested.admin;
      if (!instAdmin && instNested.source) instAdmin = instNested.source;
      if (!instId && instNested.token) instId = instNested.token;
      if (!instId && instNested.urn) {
        const parts = instNested.urn.split('::');
        if (parts.length >= 2) instId = parts[1];
      }
    }

    // Shape 2: args.instrumentId = { id, admin, source } atau string.
    if (!instId) {
      const instIdField = args.instrumentId as
        | { id?: string; admin?: string; source?: string }
        | string
        | undefined;
      if (typeof instIdField === 'object' && instIdField?.id) {
        instId = instIdField.id;
        instAdmin = instAdmin || instIdField.admin || instIdField.source || '';
      } else if (typeof instIdField === 'string') {
        instId = instIdField;
      }
    }

    // Shape 3: flat args.instrumentAdmin + args.instrumentId (string).
    if (!instId && typeof args.instrumentAdmin === 'string') {
      instAdmin = instAdmin || (args.instrumentAdmin as string);
      if (typeof args.instrumentId === 'string') {
        instId = args.instrumentId as string;
      }
    }

    // Shape 4: nested di args.transfer.instrumentId (TransferOffer shape).
    if (!instId) {
      const transfer = args.transfer as
        | { instrumentId?: { id?: string; admin?: string; source?: string } }
        | undefined;
      const tInst = transfer?.instrumentId;
      if (tInst?.id) {
        instId = tInst.id;
        instAdmin = instAdmin || tInst.admin || tInst.source || '';
      }
    }

    // Shape 5: USDCx holding — args.registrar = admin party + args.label = id.
    if (!instAdmin && typeof args.registrar === 'string') {
      instAdmin = args.registrar as string;
      if (!instId && typeof args.label === 'string') {
        instId = args.label as string;
      }
    }

    return { instrumentId: instId, instrumentAdmin: instAdmin };
  }

  /**
   * Extract amount string dari createArgument token Holding. Coba field:
   *   args.amount (string) → amount.initialAmount → amount.amount →
   *   args.balance → args.quantity
   */
  private extractTokenAmount(args: Record<string, unknown>): string | null {
    const amtObj = args.amount as Record<string, unknown> | undefined;
    if (typeof args.amount === 'string') return args.amount;
    if (typeof amtObj?.initialAmount === 'string') return amtObj.initialAmount;
    if (typeof amtObj?.amount === 'string') return amtObj.amount;
    if (typeof args.balance === 'string') return args.balance;
    if (typeof args.quantity === 'string') return args.quantity;
    return null;
  }

  /**
   * Cek apakah party = system wallet (bukan user Canquest). System party TIDAK
   * perlu di-resolve ke user → skip diam-diam (cegah DB lookup sia-sia + log noise).
   *
   * System party dikenali via prefix: `DSO`, `canquest-validator`, `Cantex`,
   * `Bridge-Operator`, `validator-app`. User party format: `<username>::<hash>`
   * (mis. `karel::1220...`) atau `auth0_<keycloakSub>` (mis. `auth0_007c...`).
   *
   * PENTING: `auth0_` BUKAN system party — itu format keycloakSub user Canquest!
   */
  private isSystemParty(partyId: string): boolean {
    if (!partyId) return true;
    if (partyId.startsWith('canquest:')) return true; // app-internal party
    return (
      partyId.startsWith('DSO') ||
      partyId.startsWith('canquest-validator') ||
      partyId.startsWith('Cantex') ||
      partyId.startsWith('cantex::') ||
      partyId.startsWith('Bridge-Operator') ||
      partyId.startsWith('validator-app')
    );
  }

  /** Simpan info holding ke cache (untuk decrement saat archived). */
  private putHoldingCache(
    contractId: string,
    data: { userId: string; instrumentId: string; instrumentAdmin: string; amount: number },
  ): void {
    // Evict oldest kalau mendekati max.
    if (this.holdingCache.size >= BalanceEventHandlerService.HOLDING_CACHE_MAX) {
      const oldest = [...this.holdingCache.entries()].sort(
        (a, b) => a[1].cachedAt - b[1].cachedAt,
      )[0];
      if (oldest) this.holdingCache.delete(oldest[0]);
    }
    this.holdingCache.set(contractId, { ...data, cachedAt: Date.now() });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Archived event handlers (balance decrease)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle ArchivedEvent: holding di-archive (consumed by transfer/lock/swap).
   *
   * Untuk token (Registry Holding): **decrement balance owner** supaya saldo
   * sender turun real-time (CC punya reconciler poll fallback, TAPI token TIDAK
   * — satu-satunya sumber decrement token = handler ini baca holdingCache).
   *
   * Untuk Amulet (CC): hanya push realtime (frontend refetch), outflow tracking
   * via CcInboundSyncService polling (CC punya reconciler sendiri).
   */
  private async handleArchivedEvent(
    a: { contractId: string; templateId: string; witnessParties?: string[] },
  ): Promise<void> {
    const template = a.templateId || '';
    const isAmulet = template.includes(':Splice.Amulet:Amulet');
    const isToken = this.isTokenHoldingTemplate(template);
    if (!isAmulet && !isToken) return;

    // ── Token: decrement balance via holdingCache ────────────────────────
    // Saat holding USDCx di-archive (transfer keluar / swap / burn), kurangi
    // CantexTokenBalance owner. Tanpa ini, sender balance tidak pernah turun
    // untuk token (CC aman via reconciler poll, token TIDAK punya reconciler).
    if (isToken) {
      const cached = this.holdingCache.get(a.contractId);
      if (cached) {
        try {
          const row = await this.prisma.cantexTokenBalance.findFirst({
            where: {
              userId: cached.userId,
              instrumentId: { equals: cached.instrumentId, mode: 'insensitive' },
              instrumentAdmin: { equals: cached.instrumentAdmin, mode: 'insensitive' },
            },
            select: { id: true, balance: true },
          });
          if (row) {
            // Decrement, TAPI jangan di bawah 0 (safety: cached amount bisa beda
            // dari actual kalau ada reconciliation gap).
            const newBalance = row.balance.minus(new Decimal(cached.amount));
            await this.prisma.cantexTokenBalance.update({
              where: { id: row.id },
              data: { balance: newBalance.lt(0) ? new Decimal(0) : newBalance },
            });
            this.logger.log(
              `BalanceEventHandler: CantexTokenBalance -${cached.amount} ${cached.instrumentId} ` +
                `(archive cid=${a.contractId.slice(0, 12)}…) → user=${cached.userId.slice(0, 8)}…`,
            );
            this.realtime.push(cached.userId, 'balance:changed', null);
          }
        } catch (err) {
          this.logger.warn(
            `BalanceEventHandler: token decrement failed cid=${a.contractId.slice(0, 12)}…: ${String(err)}`,
          );
        }
        this.holdingCache.delete(a.contractId);
        return; // sudah di-handle, skip generic witness push di bawah.
      }
      // Cache miss (handler restart antara create & archive, atau create dari
      // offset lama sebelum handler start) → tidak tahu amount/owner. Fallback:
      // push realtime ke witnessParties supaya frontend refetch balance dari
      // REST ledger endpoint.
    }

    // ── Generic: push realtime balance:changed ke witnessParties ─────────
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
   * Resolve owner party / keycloak sub → user via DB. Cache 5 menit.
   *
   * Owner di event bisa datang dalam beberapa bentuk:
   *   1. Canton party ID penuh: "karel::12209fe74271728c..."
   *   2. Keycloak sub (format auth0): "auth0_007c6643538f2eadd3e573dd05b9"
   *   3. Username prefix: "karel" (jarang, tapi mungkin)
   *
   * Strategi: coba match di 3 field berurutan:
   *   1. cantonPartyId (case-insensitive exact match)
   *   2. keycloakId (case-insensitive exact match)
   *   3. cantonPartyId startsWith (mis. party "karel::xxx" → match username "karel")
   *
   * Owner bisa juga system wallet (DSO, validator, fee, Cantex trading account,
   * Bridge-Operator) → return null (skip diam-diam, bukan error).
   */
  private async resolveUserByParty(
    partyId: string,
  ): Promise<{ userId: string; username: string | null } | null> {
    if (!partyId || partyId.startsWith('canquest:')) return null;

    // Check cache.
    const cached = this.ownerCache.get(partyId);
    if (cached && Date.now() - cached.cachedAt < OWNER_CACHE_TTL_MS) {
      return cached.userId ? cached : null;
    }

    // Extract username prefix dari party ID (sebelum "::") untuk fallback match.
    // Mis. "karel::1220..." → "karel". "auth0_007c..." → null (no ::).
    const usernameHint = partyId.includes('::')
      ? partyId.split('::')[0]
      : null;

    // Cari user — coba cantonPartyId exact, lalu keycloakId exact, lalu username.
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { cantonPartyId: { equals: partyId, mode: 'insensitive' } },
          { keycloakId: { equals: partyId, mode: 'insensitive' } },
          ...(usernameHint
            ? [{ username: { equals: usernameHint, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      select: { id: true, username: true },
    });

    // Fallback terakhir: kalau masih tidak ketemu dan partyId diawali "auth0_",
    // coba match keycloakId dengan startWith (kadang ada prefix/suffix beda).
    if (!user && partyId.startsWith('auth0_')) {
      user = await this.prisma.user.findFirst({
        where: { keycloakId: { contains: partyId, mode: 'insensitive' } },
        select: { id: true, username: true },
      });
    }

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
