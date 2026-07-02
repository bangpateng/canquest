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
 * LedgerIndexerService — poll Canton CC transfers via the Modo API & sync to DB.
 *
 * Previously polled the Lighthouse Explorer API; now polls the Modo API
 * (api.modo.link/canton-mainnet/v1), which is the explorer/data layer we link to.
 *
 * Modo API (via ModoApiService):
 *   GET /transfers/{partyId}?role=ANY&size=50&sortBy=CREATED_AT&cursor={cursor}
 *   Cursor-based pagination ({ content, hasNextPage, nextCursor }).
 *   Each transfer: { eventId "1220…:N", transferType, createdAt(ms), … }.
 *
 * What gets indexed:
 *   - CC transfers (transferType ∈ {Transfer, Instruction, Mergesplit})
 *     → settle matching CcTransaction (set settledAt + cantonUpdateId)
 *
 * Architecture:
 *   - Polling every INDEXER_POLL_INTERVAL ms (default 15 seconds)
 *   - Tracks last processed page per party in-memory (Modo is page-based)
 *   - Does not block the HTTP server (setInterval, cleanup in OnModuleDestroy)
 *
 * Enable with env:
 *   LEDGER_INDEXER_ENABLED=true
 *   LEDGER_INDEXER_PARTY_IDS=party1::hash,party2::hash   (comma-separated)
 *   MODO_API_URL=https://api.modo.link/canton-mainnet/v1
 *   MODO_API_KEY=…
 */
@Injectable()
export class LedgerIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerIndexerService.name);
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly watchParties: string[];

  private timer: NodeJS.Timeout | null = null;
  /** Last seen eventId per party id — stop a poll cycle once we re-encounter it. */
  private lastSeenEvent: Map<string, string> = new Map();
  private running = false;
  /** Avoid log spam when API is down — warn once until reachable again */
  private loggedUnreachable = false;

  /** Max pages fetched per party per poll cycle to avoid timeouts. */
  private static readonly MAX_PAGES_PER_POLL = 5;
  /** Page size for Modo transfer queries. */
  private static readonly PAGE_SIZE = 50;

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
        'Ledger Indexer enabled but MODO_API_KEY is not set — skipping',
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
   * Poll one batch of transfers from the Modo API.
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
   * Poll each watched party separately via the Modo API.
   *
   * For each party:
   *   GET /transfers/{partyId}?role=ANY&size=50&sortBy=CREATED_AT&cursor={cursor}
   *   - Start from page 1 (no cursor = newest first), page forward via nextCursor.
   *   - Stop early once we reach an eventId we already processed last cycle.
   */
  private async fetchAndProcessUpdates(): Promise<void> {
    const parties = await this.resolveWatchParties();
    if (parties.length === 0) return;

    for (const party of parties) {
      await this.pollParty(party);
    }
  }

  /** Fetch and process transfers for a single party, following the cursor. */
  private async pollParty(partyId: string): Promise<void> {
    const lastSeen = this.lastSeenEvent.get(partyId);
    let cursor: string | undefined = undefined;
    let pagesProcessed = 0;
    let newestProcessed: string | null = null;
    let stoppedAtKnown = false;

    while (pagesProcessed < LedgerIndexerService.MAX_PAGES_PER_POLL) {
      pagesProcessed += 1;

      const result = await this.modo.getTransfersByParty(partyId, {
        size: LedgerIndexerService.PAGE_SIZE,
        cursor,
      });

      if (!result) {
        if (!this.loggedUnreachable) {
          this.loggedUnreachable = true;
          this.logger.warn(
            `Modo API not reachable/indexed (indexer keeps retrying) for party ${partyId.slice(0, 16)}…`,
          );
        }
        return;
      }

      if (this.loggedUnreachable) {
        this.loggedUnreachable = false;
        this.logger.log(`Modo API reachable again for party ${partyId.slice(0, 16)}…`);
      }

      const transfers = result.transfers ?? [];
      if (transfers.length === 0) break;

      this.logger.debug(
        `Ledger Indexer: ${transfers.length} transfers (page ${pagesProcessed}) for party ${partyId.slice(0, 16)}…`,
      );

      for (const tx of transfers) {
        // Reached an event we already processed last cycle → done for now.
        if (lastSeen && tx.eventId === lastSeen) {
          stoppedAtKnown = true;
          break;
        }
        if (!newestProcessed) newestProcessed = tx.eventId; // first = newest
        await this.processTransfer(tx);
      }

      if (stoppedAtKnown || !result.hasNextPage || !result.nextCursor) break;
      cursor = result.nextCursor;
    }

    // Remember the newest eventId we touched this cycle (first in newest-first
    // order) so the next cycle stops when it re-encounters it.
    if (newestProcessed) this.lastSeenEvent.set(partyId, newestProcessed);
  }

  /**
   * CC transfer type names used by Modo. Includes "Transfer" (direct CIP-56),
   * "Instruction" (transfer-instruction create/accept), and "Mergesplit" (mint
   * rebalancing). Rows with non-zero CC movement that touch this party settle
   * the matching CcTransaction. Non-CC event types are ignored.
   */
  private static readonly CC_TRANSFER_TYPES = new Set([
    'Transfer',
    'Instruction',
    'Mergesplit',
  ]);

  /**
   * Process one Modo transfer.
   *
   * A CC transfer on-chain is identified by transferType ∈ CC_TRANSFER_TYPES.
   * For these we settle the matching CcTransaction. Match keys:
   *   - cantonUpdateId = eventId root (eventId without ":N")
   *   - ledgerTxId also matched against the eventId root as a fallback (the
   *     app records the Canton contract/offer id there, which may equal the
   *     transaction root for CIP-56 transfers).
   */
  private async processTransfer(tx: ModoTransfer): Promise<void> {
    if (!LedgerIndexerService.CC_TRANSFER_TYPES.has(tx.transferType)) return;
    if (!tx.eventId) return;

    const updateId = tx.eventId.replace(/:[0-9]+$/, '');
    const settledAt = new Date(tx.createdAt);

    try {
      // Settle by cantonUpdateId OR ledgerTxId equal to the transfer root.
      const settled = await this.prisma.ccTransaction.updateMany({
        where: {
          settledAt: null,
          OR: [{ cantonUpdateId: updateId }, { ledgerTxId: updateId }],
        },
        data: {
          settledAt,
          cantonUpdateId: updateId,
        },
      });

      if (settled.count > 0) {
        this.logger.debug(
          `Indexed CC transfer: ${updateId.slice(0, 16)}… (${settled.count} row)`,
        );
      }
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
      modoUrl: this.modo.isConfigured()
        ? (this.config.get<string>('MODO_API_URL') ??
          'https://api.modo.link/canton-mainnet/v1')
        : null,
      lastSeenEvent: Object.fromEntries(this.lastSeenEvent),
      watchParties: this.watchParties.length,
      pollIntervalMs: this.pollIntervalMs,
    };
  }
}
