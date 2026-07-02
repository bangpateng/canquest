import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ModoApiService, type ModoTransfer } from '../canton/modo-api.service';

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
        await this.processTransfer(tx);
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
   * A CC transfer settlement is identified by transferType ∈
   * { Transfer, Instruction, Mergesplit }. We derive the updateId (eventId
   * minus the ":N" suffix) and settle the matching CcTransaction by either
   * cantonUpdateId or ledgerTxId.
   */
  private async processTransfer(tx: ModoTransfer): Promise<void> {
    const isCcTransfer =
      !!tx.transferType &&
      LedgerIndexerService.CC_TRANSFER_TYPES.has(tx.transferType);
    if (!isCcTransfer) return;
    if (!tx.eventId) return;

    const updateId = tx.eventId.replace(/:[0-9]+$/, '');
    const settledAt = new Date(Number(tx.createdAt));

    try {
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

      this.logger.debug(`Indexed CC transfer: ${updateId.slice(0, 16)}…`);
    } catch (err) {
      this.logger.warn(`processTransfer error: ${String(err)}`);
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
