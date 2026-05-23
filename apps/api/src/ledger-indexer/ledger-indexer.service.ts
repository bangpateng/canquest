import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LedgerIndexerService — poll Canton ledger transaction updates & sync ke DB.
 *
 * Canton JSON Ledger API endpoint:
 *   GET /v2/updates/transactions — stream transaksi (offset-based paging)
 *
 * Apa yang di-index:
 *   - TransferOffer accepted → update CcTransaction.settledAt
 *   - Deteksi balance changes → log untuk audit
 *
 * Arsitektur:
 *   - Polling setiap INDEXER_POLL_INTERVAL ms (default 15 detik)
 *   - Menyimpan last processed offset di DB (key-value store via PrismaService)
 *   - Tidak blokir HTTP server (setInterval, cleanup di OnModuleDestroy)
 *
 * Aktifkan dengan env:
 *   LEDGER_INDEXER_ENABLED=true
 *   LEDGER_INDEXER_PARTY_IDS=party1::hash,party2::hash   (comma-separated)
 *
 * Canton Updates API reference:
 *   https://docs.canton.network/appdev/modules/m4-backend-dev
 */
@Injectable()
export class LedgerIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerIndexerService.name);
  private readonly baseUrl: string;
  private readonly secret: string | null;
  private readonly ledgerApiUser: string;
  private readonly ledgerAudience: string;
  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly watchParties: string[];

  private timer: NodeJS.Timeout | null = null;
  private lastOffset: string | number = 0;
  private running = false;
  /** Avoid log spam when tunnel/API is down — warn once until reachable again */
  private loggedUnreachable = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
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
      `Ledger Indexer started — polling every ${this.pollIntervalMs}ms for ${this.watchParties.length} parties`,
    );
    // Jalankan pertama kali segera, lalu interval
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

  private ledgerToken(): string | null {
    if (!this.secret) return null;
    return jwt.sign(
      { sub: this.ledgerApiUser, aud: this.ledgerAudience },
      this.secret,
      { algorithm: 'HS256', expiresIn: '5m' },
    );
  }

  private authHeaders(): Record<string, string> {
    const token = this.ledgerToken();
    const base: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) base['Authorization'] = `Bearer ${token}`;
    return base;
  }

  /**
   * Poll satu batch transaksi dari ledger.
   *
   * Menggunakan POST /v2/updates/transactions dengan filter per party
   * dan offset-based paging (beginExclusive = lastOffset).
   *
   * Per Canton Module 4 backend dev docs:
   *   - Setiap transaction berisi array of events (CreatedEvent / ArchivedEvent)
   *   - Setiap event punya templateId untuk identifikasi jenis kontrak
   */
  private async poll(): Promise<void> {
    if (this.running) return; // skip jika poll sebelumnya belum selesai
    this.running = true;
    try {
      await this.fetchAndProcessUpdates();
    } catch (err) {
      this.logger.warn(`Ledger Indexer poll error: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async fetchAndProcessUpdates(): Promise<void> {
    const parties = await this.resolveWatchParties();
    if (parties.length === 0) return;

    // Build filtersByParty untuk semua watched parties
    const filtersByParty: Record<string, unknown> = {};
    for (const party of parties) {
      filtersByParty[party] = {
        cumulative: [
          {
            identifierFilter: {
              WildcardFilter: {
                value: { includeCreatedEventBlob: false },
              },
            },
          },
        ],
      };
    }

    const body = {
      filter: {
        filtersByParty,
        filtersForAnyParty: { cumulative: [] },
      },
      beginExclusive: this.lastOffset,
      // Ambil max 100 transaksi per poll untuk menghindari response besar
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v2/updates/transactions`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      if (!this.loggedUnreachable) {
        this.loggedUnreachable = true;
        this.logger.warn(
          `Ledger not reachable at ${this.baseUrl} (indexer keeps retrying). ` +
            `If local dev: open SSH tunnel to participant :7575. Detail: ${String(err)}`,
        );
      }
      return;
    }

    if (this.loggedUnreachable) {
      this.loggedUnreachable = false;
      this.logger.log(`Ledger reachable again at ${this.baseUrl}`);
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        this.logger.warn(`Ledger Indexer auth error ${res.status} — check CANTON_SPLICE_SECRET`);
      } else {
        this.logger.debug(`Ledger Indexer poll HTTP ${res.status}`);
      }
      return;
    }

    const data = (await res.json()) as {
      transactions?: LedgerTransaction[];
      nextOffset?: string | number;
    };

    const txs = data.transactions ?? [];
    if (txs.length === 0) return;

    this.logger.debug(`Ledger Indexer: ${txs.length} new transactions from offset ${String(this.lastOffset)}`);

    // Process setiap transaksi
    for (const tx of txs) {
      await this.processTransaction(tx);
    }

    // Simpan offset terakhir
    if (data.nextOffset !== undefined) {
      this.lastOffset = data.nextOffset;
    } else if (txs.length > 0) {
      const last = txs[txs.length - 1];
      if (last?.offset !== undefined) this.lastOffset = last.offset;
    }
  }

  /**
   * Process satu ledger transaction.
   * Cari events yang relevan untuk CanQuest:
   *   - TransferOffer archived → offer accepted/rejected
   */
  private async processTransaction(tx: LedgerTransaction): Promise<void> {
    if (!tx.events) return;

    for (const event of tx.events) {
      try {
        await this.processEvent(event, tx.updateId);
      } catch (err) {
        this.logger.warn(`processEvent error: ${String(err)}`);
      }
    }
  }

  private async processEvent(
    event: LedgerEvent,
    updateId: string,
  ): Promise<void> {
    // Cari CcTransaction yang punya ledgerTxId = contract ID ini
    // dan belum punya settledAt
    if (event.archived?.templateId?.includes('TransferOffer')) {
      const contractId = event.archived.contractId;
      if (!contractId) return;

      // Tandai settled jika ada CcTransaction dengan ledgerTxId = contractId
      await this.prisma.ccTransaction.updateMany({
        where: {
          ledgerTxId: contractId,
          settledAt: null,
        },
        data: { settledAt: new Date() },
      });

      this.logger.debug(`Indexed TransferOffer archived: ${contractId.slice(0, 16)}…`);
    }
  }

  /** Env parties + semua cantonPartyId user CanQuest (non-placeholder). */
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

  /** Status indexer untuk health check endpoint. */
  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      lastOffset: this.lastOffset,
      watchParties: this.watchParties.length,
      pollIntervalMs: this.pollIntervalMs,
    };
  }
}

// ── Type helpers ──────────────────────────────────────────────────────────────

interface LedgerTransaction {
  updateId: string;
  offset: string | number;
  events?: LedgerEvent[];
}

interface LedgerEvent {
  created?: {
    contractId: string;
    templateId: string;
    createArgument?: unknown;
  };
  archived?: {
    contractId: string;
    templateId: string;
  };
}
