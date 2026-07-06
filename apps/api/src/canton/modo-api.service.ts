import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ModoApiService — single gateway for the Modo Transfer/Contract API.
 *
 * Replaces the former Lighthouse Explorer usage across:
 *   - Onchain transaction history (GET /v1/transfers/{partyId})
 *   - Explorer link generation (cc.modo.link/mainnet/event/{id}:0)
 *   - Event-id / update-id resolution + contract-detail lookups
 *   - Ledger indexer settlement sync
 *
 * Env:
 *   MODO_API_URL=https://api.modo.link/canton-mainnet   (base, TANPA /v1)
 *   MODO_API_KEY=<api key>                              (header X-API-Key)
 *
 * Fail-soft: every fetch returns null on HTTP error / non-OK so callers can
 * degrade gracefully (empty list, null explorer link) instead of throwing.
 */
@Injectable()
export class ModoApiService {
  private readonly logger = new Logger(ModoApiService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(config: ConfigService) {
    // Normalisasi: MODO_API_URL boleh ditulis dengan atau tanpa suffix /v1.
    // Kode method selalu tambah /v1/ di path, jadi kalau user set /v1 di env,
    // strip dulu supaya tidak jadi double /v1/v1/ (menyebabkan 403).
    const raw = (
      config.get<string>('MODO_API_URL') ??
      'https://api.modo.link/canton-mainnet'
    )
      .replace(/\/$/, '')
      .replace(/\/v1$/i, '');
    this.baseUrl = raw;
    this.apiKey = config.get<string>('MODO_API_KEY') || undefined;
  }

  /** Both base URL and API key must be configured for any Modo call to work. */
  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /**
   * Build a Modo explorer link for an update id.
   *
   * Targets the EVENT page (/event/{id}:0), bukan update page (/updates/{id}):
   *   - Event page menampilkan detail aksi utama (sender/receiver/amount untuk
   *     transfer) yang user butuhkan saat klik "View on Modo".
   *   - Root event node ":0" = exercise choice utama (AmuletRules_Transfer /
   *     LockedAmulet_OwnerExpireLockV2 / preapproval choice) — konsisten untuk
   *     semua jenis transaksi.
   *   - updateId disimpan tanpa suffix ":N"; suffix ":0" ditambahkan di sini.
   *
   * Returns null for empty input.
   */
  explorerUrl(updateId: string | null | undefined): string | null {
    if (!updateId?.trim()) return null;
    const id = updateId.trim().replace(/:[0-9]+$/, '');
    // encodeURIComponent encode ":" jadi "%3A" → ":0" jadi "%3A0". Modo accept
    // keduanya; pakai %3A0 agar URL aman (titik dua bisa ambigu di beberapa
    // parser) konsisten dengan URL contoh yang sudah diverifikasi jalan.
    return `https://cc.modo.link/mainnet/event/${encodeURIComponent(id)}%3A0`;
  }

  /**
   * Resolve a Canton update_id ("1220…", no ":N") from an event_id ("…:N"),
   * an existing update_id, or a contract id.
   *
   * Strategy (pure string logic, optional /contracts fallback):
   *   1. Empty / internal marker (fee:, claim:, namespace: tan "::") → null.
   *   2. Starts with "1220" → already an update id, return unchanged.
   *   3. Trailing ":N" (event_id) → strip suffix.
   *   4. Long id (>16 chars, contract id) → GET /v1/contracts/{id}, read
   *      creatingUpdate / creatingEvent.
   *   5. Otherwise null.
   */
  resolveUpdateId(
    _partyId: string,
    updateIdOrContractId: string | null | undefined,
  ): Promise<string | null> {
    const id = updateIdOrContractId?.trim();
    if (!id) return Promise.resolve(null);
    if (this.isInternalMarker(id)) return Promise.resolve(null);
    if (id.startsWith('1220')) return Promise.resolve(id);
    if (/:[0-9]+$/.test(id)) {
      return Promise.resolve(id.replace(/:[0-9]+$/, ''));
    }
    if (id.length > 16) {
      return this.resolveContractCreatingUpdate(id);
    }
    return Promise.resolve(null);
  }

  /** Alias for resolveUpdateId (event_id and update_id share the same root). */
  resolveEventId(
    partyId: string,
    updateIdOrContractId: string | null | undefined,
  ): Promise<string | null> {
    return this.resolveUpdateId(partyId, updateIdOrContractId);
  }

  /**
   * Fetch paginated transfers for a party.
   * GET {baseUrl}/v1/transfers/{partyId}?size=&role=&sortBy=&cursor=
   * Normalizes Modo's envelope into { transfers, hasNextPage, nextCursor }.
   */
  async getTransfersByParty(
    partyId: string,
    opts: { size?: number; role?: string; sortBy?: string; cursor?: string } = {},
  ): Promise<{
    transfers: ModoTransfer[];
    hasNextPage: boolean;
    nextCursor: string | null;
  } | null> {
    if (!this.isConfigured()) return null;
    const size = opts.size ?? 50;
    const role = opts.role ?? 'ANY';
    const sortBy = opts.sortBy ?? 'AGE';

    const url = new URL(
      `${this.baseUrl}/v1/transfers/${encodeURIComponent(partyId)}`,
    );
    url.searchParams.set('size', String(size));
    url.searchParams.set('role', role);
    url.searchParams.set('sortBy', sortBy);
    if (opts.cursor) url.searchParams.set('cursor', opts.cursor);

    const data = await this.getJson<ModoTransfersResponse>(url.toString());
    if (!data) return null;
    const content = Array.isArray(data.content) ? data.content : [];
    return {
      transfers: content,
      hasNextPage: Boolean(data.hasNextPage),
      nextCursor: data.nextCursor ?? null,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Reject placeholder / internal markers that never resolve to a real update. */
  private isInternalMarker(id: string): boolean {
    if (id.startsWith('1220')) return false;
    // namespace prefix tanpa "::" (bukan party id canton valid)
    if (/^[a-z][a-z0-9-]*:/i.test(id) && !id.includes('::')) return true;
    if (/^(inbound-sync|fee|claim|manual|placeholder):/i.test(id)) return true;
    return false;
  }

  /** Resolve creatingUpdate / creatingEvent from GET /v1/contracts/{id}. */
  private async resolveContractCreatingUpdate(
    contractId: string,
  ): Promise<string | null> {
    const data = await this.getJson<{
      creatingUpdate?: string;
      creatingEvent?: string;
    }>(`${this.baseUrl}/v1/contracts/${encodeURIComponent(contractId)}`);
    const update = data?.creatingUpdate ?? data?.creatingEvent ?? null;
    return update && update.startsWith('1220') ? update : null;
  }

  /** Shared GET with X-API-Key, 12s timeout, fail-soft → null. */
  private async getJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        this.logger.debug(`Modo API HTTP ${res.status} for ${url.slice(0, 80)}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.debug(`Modo API fetch error: ${String(err)}`);
      return null;
    }
  }
}

// ── Modo response types ──────────────────────────────────────────────────────

export interface ModoTransferParty {
  partyId: string;
  accountName?: string;
}

export interface ModoTransfer {
  eventId: string;
  transferType?: string;
  senders?: ModoTransferParty[];
  receivers?: ModoTransferParty[];
  amount?: number;
  fee?: number;
  createdAt: number; // epoch millis
}

interface ModoTransfersResponse {
  content?: ModoTransfer[];
  hasNextPage?: boolean;
  nextCursor?: string;
}
