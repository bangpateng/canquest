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
 * Explorer:  https://cc.modo.link/mainnet/updates/{updateId}
 *            (updateId = eventId without the trailing ":N", format "1220…")
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

  /**
   * Explorer link for an updateId (or eventId — ":N" suffix stripped if present).
   * Null if id empty. Pattern: https://cc.modo.link/mainnet/updates/{updateId}
   */
  explorerUrl(updateId: string | null | undefined): string | null {
    if (!updateId?.trim()) return null;
    const id = updateId.trim().replace(/:[0-9]+$/, '');
    return `https://cc.modo.link/mainnet/updates/${encodeURIComponent(id)}`;
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
   * Resolve a Canton updateId ("1220…", no ":N") for explorer linking.
   *
   * The explorer link cc.modo.link/mainnet/updates/{id} needs an updateId
   * (no ":N" suffix). Accepts either an eventId ("…:N") or updateId ("…") and
   * always returns the bare updateId form.
   *
   * Strategy:
   *   1. Internal marker ("inbound-sync:…", "fee:…", etc.) → null (no link).
   *      MUST be checked before the ":N" regex: inbound-sync ids end with a
   *      Date.now() timestamp ("…:1782975432746") that the regex would match.
   *   2. Bare "1220…" (looks like updateId) → use as-is.
   *   3. eventId "…:N" → strip the ":N" → bare updateId.
   *   4. Looks like a contract id (not "1220…")? → resolve via contract detail
   *      `creatingUpdate`.
   *   5. Unknown → null.
   */
  async resolveUpdateId(
    partyId: string,
    updateIdOrContractId: string | null | undefined,
  ): Promise<string | null> {
    const id = updateIdOrContractId?.trim();
    if (!id) return null;
    // 1. Internal/non-onchain marker — never has an explorer link.
    if (this.isInternalMarker(id)) return null;
    // 2. Bare updateId (on-chain transaction root, format "1220…").
    if (id.startsWith('1220')) return id;
    // 3. eventId "…:N" → strip suffix → bare updateId.
    if (/:[0-9]+$/.test(id)) return id.replace(/:[0-9]+$/, '');
    // 4. Contract id → creatingUpdate.
    if (id.length > 16) {
      const contract = await this.getContractDetail(id);
      const creatingUpdate = contract?.creatingUpdate ?? contract?.creatingEvent;
      if (creatingUpdate) {
        return creatingUpdate.startsWith('1220') ? creatingUpdate : null;
      }
    }
    // 5. Unknown → no explorer link.
    return null;
  }

  /**
   * True for internal-only ledger markers that never map to an on-chain Modo
   * transfer (no explorer link). Covers inbound-sync balance-sync rows, fee
   * rows, and any other "<word>:" synthetic id that is not a Canton hash.
   */
  private isInternalMarker(id: string): boolean {
    if (id.startsWith('1220')) return false;
    // Synthetic markers: "inbound-sync:…", "fee:…", etc. — a known word before
    // the first colon, not a hex party suffix.
    if (/^[a-z][a-z0-9-]*:/i.test(id) && !id.includes('::')) return true;
    // Also catch "inbound-sync:party::suffix" (has :: but starts with a marker).
    if (/^(inbound-sync|fee|claim|manual|placeholder):/i.test(id)) return true;
    return false;
  }

  /** @deprecated alias kept for the resolver callers in TransactionDetailService. */
  resolveEventId(
    partyId: string,
    updateIdOrContractId: string | null | undefined,
  ): Promise<string | null> {
    return this.resolveUpdateId(partyId, updateIdOrContractId);
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
