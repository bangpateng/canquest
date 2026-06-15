import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LedgerIndexerService — poll Canton ledger transaction updates & sync to DB.
 *
 * Uses the Lighthouse Explorer API (public, no auth) instead of the Canton
 * JSON API directly, because the Canton JSON API at :7575 does not support
 * the /v2/updates/transactions endpoint.
 *
 * Lighthouse Explorer API:
 *   GET {LIGHTHOUSE_API_URL}/api/parties/{partyId}/tx?limit=50&cursor={cursor}
 *   Returns paginated transaction data keyed by cursor.
 *
 * What gets indexed:
 *   - AmuletRules_Transfer (or is_cip56) → CC transfer onchain
 *     → update CcTransaction.settledAt + cantonUpdateId
 *
 * Architecture:
 *   - Polling every INDEXER_POLL_INTERVAL ms (default 15 seconds)
 *   - Stores last processed cursor per party in an in-memory Map
 *   - Does not block the HTTP server (setInterval, cleanup in OnModuleDestroy)
 *
 * Enable with env:
 *   LEDGER_INDEXER_ENABLED=true
 *   LEDGER_INDEXER_PARTY_IDS=party1::hash,party2::hash   (comma-separated)
 *   LIGHTHOUSE_API_URL=https://api-canton.interscan.pro/mainnet
 */
@Injectable()
export class LedgerIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerIndexerService.name);
  // Lighthouse Explorer API base URL.
  private readonly lighthouseUrl: string;
  // Legacy Canton JSON API properties — kept to avoid breaking getStatus()
  // and existing env wiring. No longer used for polling.
  private readonly baseUrl: string;
  private readonly secret: string | null;
  private readonly ledgerApiUser: string;
  private readonly ledgerAudience: string;
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly watchParties: string[];

  private timer: NodeJS.Timeout | null = null;
  /** Last processed cursor per party id (Lighthouse pagination cursor). */
  private lastCursors: Map<string, number> = new Map();
  private running = false;
  /** Avoid log spam when API is down — warn once until reachable again */
  private loggedUnreachable = false;

  /** Max pages fetched per party per poll cycle to avoid timeouts. */
  private static readonly MAX_PAGES_PER_POLL = 5;
  /** Page size for Lighthouse transaction queries. */
  private static readonly PAGE_LIMIT = 50;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.lighthouseUrl = (
      config.get<string>('LIGHTHOUSE_API_URL') ??
      'https://api-canton.interscan.pro/mainnet'
    ).replace(/\/$/, '');
    this.baseUrl = (
      config.get<string>('CANTON_JSON_API_URL') ?? 'http://127.0.0.1:7575'
    ).replace(/\/$/, '');
    this.secret = config.get<string>('CANTON_SPLICE_SECRET') ?? null;
    this.ledgerApiUser = config.get<string>('CANTON_LEDGER_API_USER') ?? 'ledger-api-user';
    this.ledgerAudience = config.get<string>('CANTON_LEDGER_API_AUDIENCE') ?? 'https://canton.network.global';
    this.enabled = config.get<string>('LEDGER_INDEXER_ENABLED') === 'true';
    this.pollIntervalMs = Number(config.get<string>('LEDGER_INDEXER_POLL_INTERVAL_MS') ?? '15000');
    const parties = config.get<string>('LEDGER_INDEXER_PARTY_IDS') ?? '';
    this.watchParties = parties.split(',').map((p) => p.trim()).filter(Boolean);
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Ledger Indexer disabled (LEDGER_INDEXER_ENABLED != true)');
      return;
    }
    if (this.watchParties.length === 0) {
      this.logger.warn('Ledger Indexer enabled but LEDGER_INDEXER_PARTY_IDS is empty — skipping');
      return;
    }
    this.logger.log(
      `Ledger Indexer started (Lighthouse) — polling every ${this.pollIntervalMs}ms ` +
        `for ${this.watchParties.length} parties`,
    );
    // Run once immediately, then on interval
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, this.pollIntervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('Ledger Indexer stopped');
    }
  }

  /**
   * Poll one batch of transactions from the Lighthouse Explorer API.
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
   * Poll each watched party separately via the Lighthouse Explorer API.
   *
   * For each party:
   *   GET {lighthouseUrl}/api/parties/{partyId}/tx?limit=50[&cursor={cursor}]
   *   - Resume from the stored cursor if present.
   *   - Follow pagination (has_next → next_cursor) up to MAX_PAGES_PER_POLL.
   */
  private async fetchAndProcessUpdates(): Promise<void> {
    const parties = await this.resolveWatchParties();
    if (parties.length === 0) return;

    for (const party of parties) {
      await this.pollParty(party);
    }
  }

  /** Fetch and process transactions for a single party, following pagination. */
  private async pollParty(partyId: string): Promise<void> {
    let cursor = this.lastCursors.get(partyId);
    let pages = 0;

    while (pages < LedgerIndexerService.MAX_PAGES_PER_POLL) {
      pages += 1;

      const url = new URL(
        `${this.lighthouseUrl}/api/parties/${encodeURIComponent(partyId)}/tx`,
      );
      url.searchParams.set('limit', String(LedgerIndexerService.PAGE_LIMIT));
      if (cursor !== undefined) {
        url.searchParams.set('cursor', String(cursor));
      }

      let res: Response;
      try {
        res = await fetch(url.toString(), {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        if (!this.loggedUnreachable) {
          this.loggedUnreachable = true;
          this.logger.warn(
            `Lighthouse API not reachable at ${this.lighthouseUrl} (indexer keeps retrying). ` +
              `Detail: ${String(err)}`,
          );
        }
        return;
      }

      if (this.loggedUnreachable) {
        this.loggedUnreachable = false;
        this.logger.log(`Lighthouse API reachable again at ${this.lighthouseUrl}`);
      }

      if (!res.ok) {
        this.logger.debug(
          `Ledger Indexer poll HTTP ${res.status} for party ${partyId.slice(0, 16)}…`,
        );
        return;
      }

      const data = (await res.json()) as LighthouseResponse;
      const txs = data.transactions ?? [];

      if (txs.length === 0) return;

      this.logger.debug(
        `Ledger Indexer: ${txs.length} transactions for party ${partyId.slice(0, 16)}…`,
      );

      for (const tx of txs) {
        await this.processTransaction(tx);
      }

      // Advance cursor to the latest transaction id on this page so we do not
      // re-process it next cycle, even if the API does not paginate further.
      const lastTx = txs[txs.length - 1];
      if (lastTx?.id !== undefined) {
        this.lastCursors.set(partyId, lastTx.id);
      }

      const pagination = data.pagination;
      if (!pagination?.has_next || pagination.next_cursor === undefined) {
        return;
      }

      cursor = pagination.next_cursor;
      this.lastCursors.set(partyId, pagination.next_cursor);
    }
  }

  /**
   * Process one Lighthouse transaction.
   *
   * A CC transfer onchain is identified by either:
   *   - choice === "AmuletRules_Transfer", or
   *   - is_cip56 === true
   *
   * For these we settle the matching CcTransaction (ledgerTxId = contract_id).
   */
  private async processTransaction(tx: LighthouseTransaction): Promise<void> {
    const isCcTransfer = tx.choice === 'AmuletRules_Transfer' || tx.is_cip56 === true;
    if (!isCcTransfer) return;
    if (!tx.contract_id) return;

    try {
      await this.prisma.ccTransaction.updateMany({
        where: {
          ledgerTxId: tx.contract_id,
          settledAt: null,
        },
        data: {
          settledAt: new Date(tx.record_time),
          cantonUpdateId: tx.update_id,
        },
      });

      this.logger.debug(`Indexed CC transfer: ${tx.update_id.slice(0, 16)}…`);
    } catch (err) {
      this.logger.warn(`processTransaction error: ${String(err)}`);
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
      .filter((p): p is string => typeof p === 'string' && !p.startsWith('canquest:'));
    return [...new Set([...fromEnv, ...fromDb])];
  }

  /** Status indexer for health check endpoint. */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      lighthouseUrl: this.lighthouseUrl,
      lastCursors: Object.fromEntries(this.lastCursors),
      watchParties: this.watchParties.length,
      pollIntervalMs: this.pollIntervalMs,
    };
  }
}

// ── Type helpers ──────────────────────────────────────────────────────────────

interface LighthousePagination {
  has_next: boolean;
  has_previous: boolean;
  next_cursor: number;
  previous_cursor: number;
}

interface LighthouseTransaction {
  id: number;
  update_id: string;
  record_time: string;
  choice: string;
  consuming: boolean;
  acting_parties: string[];
  contract_id: string;
  is_cip56: boolean;
}

interface LighthouseResponse {
  pagination: LighthousePagination;
  transactions: LighthouseTransaction[];
}
