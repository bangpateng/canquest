import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ModoApiService — thin client for the Modo explorer/data API.
 *
 * Replaces the previous Lighthouse Explorer API integration. Modo is the
 * intelligence/explorer layer for Canton mainnet; the on-chain CC transfers
 * indexed there are what we surface as transaction history + explorer links.
 *
 * Base URL:  MODO_API_URL (default https://api.modo.link/canton-mainnet/v1)
 * Auth:      MODO_API_KEY  sent as header `x-api-key` on every request.
 * Explorer:  https://modo.link/transfers/{eventId}  (eventId = "1220…:N")
 *
 * All methods are non-fatal: on error they log + return null/[] so callers
 * (transaction detail, indexer, on-chain endpoint) degrade gracefully.
 */

/** Party actor in a Modo transfer (sender or receiver). */
export interface ModoTransferParty {
  partyId: string;
  accountName: string | null;
  imageUrl: string | null;
}

/** One transfer row from Modo GET /transfers (and /transfers?partyId=). */
export interface ModoTransfer {
  /** "1220…:N" — root event hash + node index. Splits into updateId (:0 part). */
  eventId: string;
  transferType: string; // "Transfer" | "Mergesplit" | …
  senders: ModoTransferParty[];
  receivers: ModoTransferParty[];
  /** CC amount as a decimal string/number, e.g. 100.0000000000 */
  amount: number | string;
  fee: number | string;
  amuletPrice: number | string;
  /** Unix epoch millis. */
  createdAt: number;
}

interface ModoTransfersResponse {
  content: ModoTransfer[];
  pageable?: { pageNumber?: number; pageSize?: number };
  last?: boolean;
  totalPages?: number;
  totalElements?: number;
  size?: number;
  number?: number;
}

interface ModoUpdate {
  updateId: string;
  recordTime?: number;
  effectiveAt?: number;
  rootEventIds?: string;
  eventsCount?: number;
}

export interface ModoTransfersPage {
  transfers: ModoTransfer[];
  /** Whether this is the final page (no more results). */
  last: boolean;
  pageNumber: number;
  totalPages: number;
}

@Injectable()
export class ModoApiService {
  private readonly logger = new Logger(ModoApiService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      config.get<string>('MODO_API_URL') ??
      'https://api.modo.link/canton-mainnet/v1'
    ).replace(/\/$/, '');
    this.apiKey = config.get<string>('MODO_API_KEY') || undefined;
  }

  /** Explorer link for a transfer event id ("1220…:N"). Null if id empty. */
  explorerUrl(eventId: string | null | undefined): string | null {
    if (!eventId?.trim()) return null;
    return `https://modo.link/transfers/${encodeURIComponent(eventId.trim())}`;
  }

  /** Whether the service is usable (base + key configured). */
  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /**
   * Paginated transfers, optionally filtered to a single party.
   * `page` is 0-based. Returns null on error / not configured.
   */
  async getTransfers(
    opts: { partyId?: string; size?: number; page?: number } = {},
  ): Promise<ModoTransfersPage | null> {
    if (!this.isConfigured()) {
      this.logger.debug('getTransfers skipped (MODO_API_KEY not configured)');
      return null;
    }
    const url = new URL(`${this.baseUrl}/transfers`);
    if (opts.partyId) url.searchParams.set('partyId', opts.partyId);
    url.searchParams.set('size', String(opts.size ?? 50));
    if (opts.page !== undefined) url.searchParams.set('page', String(opts.page));

    const data = await this.getJson<ModoTransfersResponse>(url.toString());
    if (!data) return null;
    const content = Array.isArray(data.content) ? data.content : [];
    return {
      transfers: content,
      last: data.last ?? true,
      pageNumber: data.pageable?.pageNumber ?? data.number ?? opts.page ?? 0,
      totalPages: data.totalPages ?? 1,
    };
  }

  /** Convenience: all recent transfers (page 0). */
  async getRecentTransfers(size = 50): Promise<ModoTransfer[]> {
    const page = await this.getTransfers({ size });
    return page?.transfers ?? [];
  }

  /** Raw update detail by updateId ("1220…" without ":N"). Null on miss/error. */
  async getUpdate(updateId: string): Promise<ModoUpdate | null> {
    if (!this.isConfigured() || !updateId?.trim()) return null;
    const url = `${this.baseUrl}/updates/${encodeURIComponent(updateId.trim())}`;
    return this.getJson<ModoUpdate>(url);
  }

  /**
   * Resolve a Modo event id ("…:N") for a Canton updateId/contractId.
   *
   * DB stores Canton update_id ("1220…", no ":N"), but explorer links need
   * event_id ("1220…:N"). Strategy mirrors the old Lighthouse resolver:
   *   1. Already "…:N"? → use as-is.
   *   2. Search the party's transfers for one whose eventId root matches → use it.
   *   3. Fallback "{updateId}:0" (Canton transaction root is always node 0).
   */
  async resolveEventId(
    partyId: string,
    updateIdOrContractId: string | null | undefined,
  ): Promise<string | null> {
    const id = updateIdOrContractId?.trim();
    if (!id) return null;
    // 1. Already an event id?
    if (/:[0-9]+$/.test(id)) return id;

    // 2. Look it up in this party's recent transfers.
    try {
      const page = await this.getTransfers({ partyId, size: 50 });
      const match = page?.transfers.find((t) => {
        const root = t.eventId.replace(/:[0-9]+$/, '');
        return root === id;
      });
      if (match?.eventId) return match.eventId;
    } catch (err) {
      this.logger.debug(
        `resolveEventId transfer lookup(${id.slice(0, 16)}…): ${String(err)}`,
      );
    }

    // 3. Non-transfer (lock/unlock/preapproval) → root node 0.
    return id.startsWith('1220') ? `${id}:0` : null;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async getJson<T>(url: string): Promise<T | null> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        this.logger.debug(`Modo API ${res.status} for ${url.slice(0, 80)}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.debug(`Modo API error for ${url.slice(0, 80)}: ${String(err)}`);
      return null;
    }
  }
}
