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
 * Endpoints (see https://docs.modo.link/api-reference):
 *   GET /transfers/{partyId}?role=ANY&size=&sortBy=&cursor=  (cursor-based)
 *       → { content[], hasNextPage, nextCursor }
 *   GET /transfers?size=                                       (page-based, all)
 *   GET /contracts/{contractId}                                → creatingUpdate
 *   GET /updates/{updateId}/raw-details
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

/** One transfer row from Modo. */
export interface ModoTransfer {
  /** "1220…:N" — root event hash + node index. updateId = eventId without ":N". */
  eventId: string;
  transferType: string; // "Transfer" | "Mergesplit" | …
  senders: ModoTransferParty[];
  receivers: ModoTransferParty[];
  /** CC amount as a decimal string/number, e.g. 100.0000000000 */
  amount: number | string;
  fee: number | string;
  amuletPrice?: number | string;
  /** Unix epoch millis. */
  createdAt: number;
}

/** A page of transfers from the cursor-based per-party endpoint. */
export interface ModoTransfersByPartyPage {
  transfers: ModoTransfer[];
  hasNextPage: boolean;
  nextCursor: string | null;
}

interface ModoContractDetail {
  contractId: string;
  templateId?: string;
  creatingEvent?: string;
  /** updateId that created this contract — key link contractId → updateId. */
  creatingUpdate?: string;
  createdAt?: number;
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
   * Transfers for a single party (PATH param endpoint — per docs).
   * Cursor-based: pass `cursor` (a previous `nextCursor`) to page forward.
   * Returns null on error / not configured.
   */
  async getTransfersByParty(
    partyId: string,
    opts: { size?: number; role?: string; sortBy?: string; cursor?: string } = {},
  ): Promise<ModoTransfersByPartyPage | null> {
    if (!this.isConfigured() || !partyId?.trim()) return null;
    const url = new URL(
      `${this.baseUrl}/transfers/${encodeURIComponent(partyId.trim())}`,
    );
    url.searchParams.set('size', String(opts.size ?? 50));
    url.searchParams.set('role', opts.role ?? 'ANY');
    url.searchParams.set('sortBy', opts.sortBy ?? 'CREATED_AT');
    if (opts.cursor) url.searchParams.set('cursor', opts.cursor);

    const data = await this.getJson<{
      content?: ModoTransfer[];
      hasNextPage?: boolean;
      nextCursor?: string;
    }>(url.toString());
    if (!data) return null;
    return {
      transfers: Array.isArray(data.content) ? data.content : [],
      hasNextPage: Boolean(data.hasNextPage),
      nextCursor: data.nextCursor ?? null,
    };
  }

  /**
   * Resolve a Modo event id ("…:N") for a Canton updateId/contractId.
   *
   * DB stores Canton update_id ("1220…", no ":N"), but explorer links need
   * event_id ("1220…:N"). Strategy:
   *   1. Already "…:N"? → use as-is.
   *   2. Search the party's recent transfers for one whose eventId root matches.
   *   3. Looks like a contract id (not "1220…")? → fetch contract detail,
   *      use its `creatingUpdate`, then "{creatingUpdate}:0".
   *   4. Fallback "{updateId}:0" (Canton transaction root is always node 0).
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
      const page = await this.getTransfersByParty(partyId, { size: 100 });
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

    // 3. Contract id (not "1220…") → resolve via contract detail creatingUpdate.
    if (!id.startsWith('1220')) {
      const contract = await this.getContractDetail(id);
      const creatingUpdate = contract?.creatingUpdate ?? contract?.creatingEvent;
      if (creatingUpdate) {
        return creatingUpdate.startsWith('1220') ? `${creatingUpdate}:0` : null;
      }
      return null;
    }

    // 4. Non-transfer update (lock/unlock/preapproval) → root node 0.
    return `${id}:0`;
  }

  /** Contract detail (incl. `creatingUpdate` linking contractId → updateId). */
  async getContractDetail(contractId: string): Promise<ModoContractDetail | null> {
    if (!this.isConfigured() || !contractId?.trim()) return null;
    const url = `${this.baseUrl}/contracts/${encodeURIComponent(contractId.trim())}`;
    return this.getJson<ModoContractDetail>(url);
  }

  /** Raw update detail (transaction tree) for an updateId. */
  async getUpdateRawDetails(updateId: string): Promise<unknown | null> {
    if (!this.isConfigured() || !updateId?.trim()) return null;
    const url = `${this.baseUrl}/updates/${encodeURIComponent(updateId.trim())}/raw-details`;
    return this.getJson<unknown>(url);
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
