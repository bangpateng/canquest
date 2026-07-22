import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ModoApiService, type ModoTransfer } from '../canton/modo-api.service';
import { cantonPartyIdsEqual } from '../common/canton-party-id';

/**
 * LedgerIndexerService — poll Canton ledger transaction updates & sync to DB.
 *
 * Uses the Modo Transfer API (api.modo.link) to settle pending CcTransaction
 * rows: when a transfer appears on-chain for a watched party, we match it by
 * updateId (eventId minus the ":N" observation suffix) against either
 * CcTransaction.cantonUpdateId or CcTransaction.ledgerTxId, then stamp
 * settledAt + cantonUpdateId.
 *
 * Modo Transfer API:
 *   GET {MODO_API_URL}/v1/transfers/{partyId}?size=50&role=ANY&sortBy=AGE
 *   Returns { content: ModoTransfer[], hasNextPage, nextCursor }.
 *
 * What gets indexed:
 *   - CC transfer (transferType ∈ Transfer/Instruction/Mergesplit) → settle
 *     matching CcTransaction (settledAt + cantonUpdateId).
 *
 * Architecture:
 *   - Polling every INDEXER_POLL_INTERVAL ms (default 15 seconds)
 *   - Stores last seen eventId per party in an in-memory Map so the next poll
 *     stops at the boundary instead of re-processing.
 *   - Does not block the HTTP server (setInterval, cleanup in OnModuleDestroy)
 *
 * Enable with env:
 *   LEDGER_INDEXER_ENABLED=true
 *   LEDGER_INDEXER_PARTY_IDS=party1::hash,party2::hash   (comma-separated)
 *   MODO_API_URL=https://api.modo.link/canton-mainnet
 *   MODO_API_KEY=<modo api key>
 */
@Injectable()
export class LedgerIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerIndexerService.name);
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly watchParties: string[];

  private timer: NodeJS.Timeout | null = null;
  /** Last seen eventId per party id — next poll stops once it reappears. */
  private lastSeenEvent: Map<string, string> = new Map();
  private running = false;

  /** Max pages fetched per party per poll cycle to avoid timeouts. */
  private static readonly MAX_PAGES_PER_POLL = 5;
  /** Page size for Modo transfer queries. */
  private static readonly PAGE_LIMIT = 50;
  /** Modo transferTypes we treat as a CC transfer settlement. */
  private static readonly CC_TRANSFER_TYPES = new Set([
    'Transfer',
    'Instruction',
    'Mergesplit',
  ]);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly modo: ModoApiService,
  ) {
    this.enabled = config.get<string>('LEDGER_INDEXER_ENABLED') === 'true';
    this.pollIntervalMs = Number(
      config.get<string>('LEDGER_INDEXER_POLL_INTERVAL_MS') ?? '15000',
    );
    const parties = config.get<string>('LEDGER_INDEXER_PARTY_IDS') ?? '';
    this.watchParties = parties
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.log(
        'Ledger Indexer disabled (LEDGER_INDEXER_ENABLED != true)',
      );
      return;
    }
    if (!this.modo.isConfigured()) {
      this.logger.warn(
        'Ledger Indexer enabled but MODO_API_URL/MODO_API_KEY not set — skipping',
      );
      return;
    }
    if (this.watchParties.length === 0) {
      this.logger.warn(
        'Ledger Indexer enabled but LEDGER_INDEXER_PARTY_IDS is empty — skipping',
      );
      return;
    }
    this.logger.log(
      `Ledger Indexer started (Modo) — polling every ${this.pollIntervalMs}ms ` +
        `for ${this.watchParties.length} parties`,
    );
    // Run once immediately, then on interval
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('Ledger Indexer stopped');
    }
  }

  /**
   * Poll one batch of transfers from the Modo Transfer API.
   * Skips if a previous poll is still running.
   */
  private async poll(): Promise<void> {
    if (this.running) return; // skip if previous poll has not finished
    this.running = true;
    try {
      await this.fetchAndProcessUpdates();
    } catch (err) {
      this.logger.warn(`Ledger Indexer poll error: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Poll each watched party separately via the Modo Transfer API.
   * For each party: page through /v1/transfers/{partyId}, stopping once we hit
   * the last eventId seen in the previous cycle.
   */
  private async fetchAndProcessUpdates(): Promise<void> {
    const parties = await this.resolveWatchParties();
    if (parties.length === 0) return;

    for (const party of parties) {
      await this.pollParty(party);
    }
  }

  /** Fetch and process transfers for a single party, following pagination. */
  private async pollParty(partyId: string): Promise<void> {
    const stopAt = this.lastSeenEvent.get(partyId);
    let cursor: string | undefined;
    let pages = 0;

    while (pages < LedgerIndexerService.MAX_PAGES_PER_POLL) {
      pages += 1;

      const result = await this.modo.getTransfersByParty(partyId, {
        size: LedgerIndexerService.PAGE_LIMIT,
        cursor,
      });
      if (!result) return; // upstream error (already logged at debug)

      const transfers = result.transfers;
      if (transfers.length === 0) return;

      this.logger.debug(
        `Ledger Indexer: ${transfers.length} transfers for party ${partyId.slice(0, 16)}…`,
      );

      // Stop processing once we reach the boundary from the previous cycle.
      let hitBoundary = false;
      for (const tx of transfers) {
        if (stopAt && tx.eventId === stopAt) {
          hitBoundary = true;
          break;
        }
        await this.processTransfer(tx, partyId);
      }

      // Remember the newest eventId (list is DESC by AGE) as next cycle's stop.
      this.lastSeenEvent.set(partyId, transfers[0].eventId);

      if (hitBoundary || !result.hasNextPage || !result.nextCursor) return;
      cursor = result.nextCursor;
    }
  }

  /**
   * Process one Modo transfer.
   *
   * Two responsibilities:
   *
   * 1. CC settlement: a CC transfer is identified by transferType ∈
   *    { Transfer, Instruction, Mergesplit }. We derive the updateId (eventId
   *    minus the ":N" suffix) and settle any matching pending CcTransaction by
   *    either cantonUpdateId or ledgerTxId.
   *
   * 2. Incoming-from-external capture: for a transfer where the watched party
   *    is in `tx.receivers` but NOT in `tx.senders`, and no pending row matches
   *    (i.e. the app did not initiate it), we CREATE a TRANSFER_IN row carrying
   *    the REAL sender partyId in `referenceId` (the legacy cc-inbound-sync path
   *    stores the receiver's own partyId there because the balance API does not
   *    reveal the sender). This unlocks the "receive from external wallet"
   *    quest task and a richer transaction history.
   *
   * Idempotency: the create relies on `@@unique([userId, ledgerTxId])` — a real
   *    on-chain updateId is unique per transfer, so a second poll cycle re-hits
   *    P2002 and is safely swallowed.
   */
  private async processTransfer(
    tx: ModoTransfer,
    watchedPartyId: string,
  ): Promise<void> {
    const isCcTransfer =
      !!tx.transferType &&
      LedgerIndexerService.CC_TRANSFER_TYPES.has(tx.transferType);
    if (!isCcTransfer) return;
    if (!tx.eventId) return;

    const updateId = tx.eventId.replace(/:[0-9]+$/, '');
    const settledAt = new Date(Number(tx.createdAt));

    try {
      // 1. Settle any pending row created by the app's send/accept paths.
      await this.prisma.ccTransaction.updateMany({
        where: {
          settledAt: null,
          OR: [{ cantonUpdateId: updateId }, { ledgerTxId: updateId }],
        },
        data: {
          settledAt,
          cantonUpdateId: updateId,
        },
      });

      // 2. Capture incoming transfer from a real sender (enables "receive from
      //    external/internal" quest tasks). Only when the watched party is a
      //    receiver and NOT a sender, and the transfer carries an amount + sender.
      const isReceiver = (tx.receivers ?? []).some((r) =>
        cantonPartyIdsEqual(r.partyId, watchedPartyId),
      );
      const isSender = (tx.senders ?? []).some((s) =>
        cantonPartyIdsEqual(s.partyId, watchedPartyId),
      );
      const senderPartyId = tx.senders?.[0]?.partyId;
      if (isReceiver && !isSender && senderPartyId && typeof tx.amount === 'number' && tx.amount > 0) {
        await this.captureInboundTransfer({
          watchedPartyId,
          senderPartyId,
          updateId,
          amount: tx.amount,
          settledAt,
        });
      }

      this.logger.debug(`Indexed CC transfer: ${updateId.slice(0, 16)}…`);
    } catch (err) {
      this.logger.warn(`processTransfer error: ${String(err)}`);
    }
  }

  /**
   * Persist a TRANSFER_IN row with the REAL sender partyId. No-op if the user
   * is unknown to CanQuest or if the row already exists (dedup via unique
   * [userId, ledgerTxId]). The legacy cc-inbound-sync row (if any) is left
   * untouched — it stays hidden from history and the two never collide because
   * their ledgerTxId formats differ ("inbound-sync:…" vs the real updateId).
   */
  private async captureInboundTransfer(params: {
    watchedPartyId: string;
    senderPartyId: string;
    updateId: string;
    amount: number;
    settledAt: Date;
  }): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        cantonPartyId: { equals: params.watchedPartyId, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (!user) return; // not a CanQuest user — nothing to credit

    const amountMicroCc = BigInt(Math.round(params.amount * 1_000_000));
    if (amountMicroCc <= 0n) return;

    try {
      await this.prisma.ccTransaction.create({
        data: {
          userId: user.id,
          amountMicroCc,
          type: 'TRANSFER_IN',
          description: `Received ${params.amount} CC from on-chain`,
          referenceId: params.senderPartyId, // ← real sender (legacy stored self)
          ledgerTxId: params.updateId, // ← real on-chain id (dedup key)
          cantonUpdateId: params.updateId,
          status: 'COMPLETED',
          settledAt: params.settledAt,
        },
      });
      this.logger.debug(
        `Captured inbound CC: user=${user.id.slice(0, 8)} from=${params.senderPartyId.slice(0, 16)}… amount=${params.amount}`,
      );
    } catch (err) {
      // P2002 = unique constraint hit (already captured) — safe to swallow.
      const msg = String(err);
      if (!msg.includes('P2002')) {
        this.logger.warn(`captureInboundTransfer error: ${msg}`);
      }
    }
  }

  /** Env parties + all cantonPartyId users of CanQuest (non-placeholder). */
  private async resolveWatchParties(): Promise<string[]> {
    const fromEnv = this.watchParties;
    const users = await this.prisma.user.findMany({
      where: { cantonPartyId: { not: null } },
      select: { cantonPartyId: true },
    });
    const fromDb = users
      .map((u) => u.cantonPartyId)
      .filter(
        (p): p is string => typeof p === 'string' && !p.startsWith('canquest:'),
      );
    return [...new Set([...fromEnv, ...fromDb])];
  }

  /** Status indexer for health check endpoint. */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      modoConfigured: this.modo.isConfigured(),
      lastSeenEvent: Object.fromEntries(this.lastSeenEvent),
      watchParties: this.watchParties.length,
      pollIntervalMs: this.pollIntervalMs,
    };
  }
}
