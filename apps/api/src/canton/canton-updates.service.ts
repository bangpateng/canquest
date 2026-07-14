/**
 * CantonUpdatesService — realtime consumer untuk Canton JSON Ledger API
 * `/v2/updates` stream.
 *
 * INSTEAD OF polling semua user setiap 30s (CcInboundSyncService) atau offer
 * setiap 60s (OfferReconcilerService), service ini subscribe ke stream ledger
 * SATU kali dengan token admin (CanReadAs semua party) lalu dispatch event
 * perubahan ke handler yang sesuai.
 *
 * ── Transport ────────────────────────────────────────────────────────────────
 * Canton `/v2/updates` BUKAN classic WebSocket upgrade. Ini HTTP/2 server-
 * streaming: satu POST request, server kirim multiple JSON object di response
 * body seiring ledger event terjadi. Kita baca body sebagai stream (reader)
 * dan parse setiap line/chunk.
 *
 * Diverifikasi support: Canton participant node v3.5.6 di
 * api-ledger-canquest.nodelab.my.id (curl test return 400 INVALID_ARGUMENT
 * untuk filter kosong = endpoint ADA & memproses request).
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * Single admin token via KeycloakTokenService.getAdminLedgerToken(). Token ini
 * punya CanReadAs untuk SEMUA party (di-grant saat allocateParty). Jadi 1 stream
 * cukup untuk pantau semua user. Tidak perlu token per-user.
 *
 * Token expire ~5 menit → refresh otomatis tiap reconnect (KeycloakTokenService
 * cache + pre-emptive refresh 60s sebelum expiry).
 *
 * ── Resilience ───────────────────────────────────────────────────────────────
 * - Reconnect exponential backoff (1s, 2s, 4s, 8s, 16s, max 10 attempts)
 * - Offset tracking: simpan offset terakhir, resume dari situ saat reconnect
 *   (event tidak hilang, tidak duplikat — offset bersifat exclusive begin)
 * - Feature flag CANTON_UPDATES_WS_ENABLED (default false — harus di-enable
 *   eksplisit setelah deploy, supaya poller existing tetap jalan sebagai
 *   fallback sampai WS terverifikasi stabil di production)
 *
 * ── Dispatch ─────────────────────────────────────────────────────────────────
 * Setiap update event di-dispatch via rxjs Subject ke handler:
 *   - CreatedEvent Amulet/transfer → balance change → CcInboundSyncService
 *   - Archive TransferInstruction → offer settlement → OfferReconcilerService
 * Handler WAJIB idempoten (bisa dipanggil berkali-kali untuk event sama tanpa
 * double-effect) karena stream bisa re-deliver saat reconnect dari checkpoint.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subject } from 'rxjs';

import { KeycloakTokenService } from '../auth/keycloak-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { CantonLedgerService } from './canton-ledger.service';
import { CcInboundSyncService } from './cc-inbound-sync.service';
import { OfferReconcilerService } from './offer-reconciler.service';

/**
 * Canton `/v2/updates` event shape (subset of fields kita pakai).
 * Lihat: https://docs.canton.network/reference/canton/json-api/ledger-endpoints
 *
 * Tiap "update" = satu top-level object yang server kirim di stream body.
 * Berisi array of "events" (CreatedEvent | ArchivedEvent).
 */
interface CantonUpdate {
  /** Ledger offset string/number untuk checkpoint. */
  offset?: string | { absolute?: string };
  updateId?: string;
  events?: Array<
    | { created: CreatedEventShape }
    | { archived: ArchivedEventShape }
  >;
  /** Mapping partyId → list of event indices untuk filter cepat. */
  eventsByIds?: Array<{ party: string; events: string[] }>;
}

interface CreatedEventShape {
  eventType: 'created';
  contractId: string;
  templateId: string;
  createArgument: Record<string, unknown>;
  signatories?: string[];
  observers?: string[];
}

interface ArchivedEventShape {
  eventType: 'archived';
  contractId: string;
  templateId: string;
  witnessParties?: string[];
}

/** Event dispatch: satu unit kerja untuk handler konsumen. */
export interface CantonUpdateEvent {
  /** Ledger offset (string) — untuk checkpoint & resume. */
  offset: string;
  updateId?: string;
  /** Party yang visible event ini (readAs). */
  parties: string[];
  created: CreatedEventShape[];
  archived: ArchivedEventShape[];
}

const MAX_RECONNECTS = 10;
const RECONNECT_BASE_DELAY_MS = 1_000;
/**
 * HTTP POST /v2/updates BUKAN long-lived stream — ini one-shot request yang
 * return semua update yang ada lalu EOF. Untuk polling real-time, tunggu
 * interval ini sebelum re-request (long-poll pattern). Default 10s supaya
 * near-realtime tanpa overload ledger API.
 */
const POLL_INTERVAL_MS = 10_000;

@Injectable()
export class CantonUpdatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CantonUpdatesService.name);
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  /** Offset terakhir yang sukses diproses — resume dari sini saat reconnect. */
  private lastOffset: string | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private streamController: AbortController | null = null;
  /** Timer untuk long-poll re-request (POLL_INTERVAL_MS setelah EOF). */
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stream of parsed update events. Handler subscribe di onModuleInit. */
  readonly updates$ = new Subject<CantonUpdateEvent>();

  constructor(
    private readonly config: ConfigService,
    private readonly keycloak: KeycloakTokenService,
    private readonly ledger: CantonLedgerService,
    private readonly prisma: PrismaService,
    private readonly inboundSync: CcInboundSyncService,
    private readonly offerReconciler: OfferReconcilerService,
  ) {
    const ledgerUrl =
      config.get<string>('LEDGER_API_URL') ||
      config.get<string>('CANTON_JSON_API_URL');
    this.baseUrl = ledgerUrl?.replace(/\/$/, '') ?? '';
    this.enabled = config.get<string>('CANTON_UPDATES_WS_ENABLED') === 'true';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('CantonUpdatesService DISABLED (set CANTON_UPDATES_WS_ENABLED=true to enable).');
      return;
    }
    if (!this.baseUrl) {
      this.logger.warn('CantonUpdatesService: no LEDGER_API_URL, skipping stream.');
      return;
    }

    // Subscribe ke event stream — dispatch per-party dengan debounce supaya
    // burst event (mis. 1 transfer bikin 5 created events) jadi 1 sync call.
    this.updates$.subscribe({
      next: (ev) => this.dispatchUpdate(ev),
      error: (err) =>
        this.logger.error(`CantonUpdates: stream subject error: ${String(err)}`),
    });

    // Non-blocking: jangan block app startup kalau ledger lambat connect.
    void this.startStream();
    this.logger.log('CantonUpdatesService ENABLED — subscribing to /v2/updates.');
  }

  /** Debounce timers per party — coalesce burst jadi 1 reconcile call. */
  private readonly partyDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly DEBOUNCE_MS = 2_000;

  /**
   * Dispatch satu update event: untuk tiap party yang visible, schedule
   * reconcile (balance + offer) dengan debounce. Non-blocking, error-tolerant.
   */
  private dispatchUpdate(ev: CantonUpdateEvent): void {
    for (const partyId of ev.parties) {
      if (!partyId || partyId.startsWith('canquest:')) continue;
      this.schedulePartyReconcile(partyId);
    }
  }

  private schedulePartyReconcile(partyId: string): void {
    // Reset timer kalau sudah ada (debounce).
    const existing = this.partyDebounce.get(partyId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.partyDebounce.delete(partyId);
      void this.reconcileParty(partyId);
    }, CantonUpdatesService.DEBOUNCE_MS);
    this.partyDebounce.set(partyId, timer);
  }

  /** Reconcile satu party: balance sync + offer settlement. Non-fatal. */
  private async reconcileParty(partyId: string): Promise<void> {
    try {
      // Balance sync (mirror CcInboundSyncService.syncUser logic).
      await this.inboundSync.reconcileParty(partyId);
    } catch (err) {
      this.logger.warn(
        `CantonUpdates: balance sync failed for ${partyId.slice(0, 12)}…: ${String(err)}`,
      );
    }
    try {
      // Offer reconciliation (detect external accept/reject).
      await this.offerReconciler.reconcileParty(partyId);
    } catch (err) {
      this.logger.warn(
        `CantonUpdates: offer reconcile failed for ${partyId.slice(0, 12)}…: ${String(err)}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.closedByUser = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.streamController?.abort();
    this.updates$.complete();
  }

  /**
   * Start streaming subscription. Idempoten — aman dipanggil berkali-kali
   * (reconnect). Ambil offset terakhir (atau dari ledgerEnd kalau belum ada).
   *
   * Filter: WAJIB pakai filtersByParty dengan list party eksplisit (dari DB).
   * filtersForAnyParty butuh permission CanReadAsAnyParty yang admin token
   * TIDAK punya → HTTP 403 (verified). filter kosong → HTTP 400 (verified).
   */
  private async startStream(): Promise<void> {
    this.closedByUser = false;
    const token = await this.getTokenSafe();
    if (!token) {
      this.scheduleReconnect(new Error('No admin token available'));
      return;
    }

    // Offset awal: kalau belum punya checkpoint, ambil dari ledgerEnd (offset
    // terbaru) supaya tidak replay seluruh history ledger (bisa jutaan event).
    let beginExclusive: string | undefined;
    if (!this.lastOffset) {
      try {
        beginExclusive = await this.fetchLedgerEnd();
        this.lastOffset = beginExclusive ?? null;
        this.logger.log(
          `CantonUpdates: starting from ledgerEnd offset=${beginExclusive}`,
        );
      } catch (err) {
        this.logger.warn(
          `CantonUpdates: ledgerEnd failed, will retry: ${String(err)}`,
        );
        this.scheduleReconnect(err as Error);
        return;
      }
    } else {
      beginExclusive = this.lastOffset;
    }

    // Load list party user dari DB (refresh tiap connect supaya user baru
    // langsung masuk). Skip placeholder (canquest:...) dan party kosong.
    const partyIds = await this.loadUserParties();
    if (partyIds.length === 0) {
      // Tidak ada user dengan wallet real → tidak ada yang dimonitor. Retry
      // 60s (bukan exponential — kondisi ini bisa berubah saat user register).
      this.logger.log(
        'CantonUpdates: no user parties yet, retrying in 60s...',
      );
      setTimeout(() => {
        if (!this.closedByUser) void this.startStream();
      }, 60_000);
      return;
    }

    // Build filtersByParty map: { partyId: { cumulative: [WildcardFilter] } }
    // WildcardFilter per-party = semua template event untuk party itu.
    const filtersByParty: Record<string, { cumulative: unknown[] }> = {};
    for (const p of partyIds) {
      filtersByParty[p] = {
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

    this.streamController = new AbortController();
    const body = {
      // Offset flat di top-level (match fetchTransactionUpdates shape line 3253).
      beginExclusive,
      filter: { filtersByParty },
      verbose: true,
    };

    this.logger.log(
      `CantonUpdates: subscribing for ${partyIds.length} party(ies) from offset=${beginExclusive}`,
    );

    try {
      const res = await fetch(`${this.baseUrl}/v2/updates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: this.streamController.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.body) {
        throw new Error('No response body stream');
      }

      this.reconnectAttempts = 0;
      this.logger.log('CantonUpdates: stream connected.');
      await this.consumeStream(res.body);
    } catch (err) {
      if (this.closedByUser) return;
      this.scheduleReconnect(err as Error);
    }
  }

  /**
   * Baca response body sebagai stream chunk-by-chunk, parse JSON object per
   * baris (newline-delimited). Canton `/v2/updates/stream` mengirim object
   * JSON terpisah oleh newline.
   */
  private async consumeStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!this.closedByUser) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // Canton stream = NDJSON (newline-delimited JSON objects).
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          this.handleStreamLine(line);
        }
      }
    } finally {
      reader.releaseLock();
      // HTTP /v2/updates = one-shot request (bukan long-lived stream). Response
      // EOF setelah return semua update yang ada. Tunggu POLL_INTERVAL_MS lalu
      // re-request (long-poll pattern) — BUKAN reconnect instan (akan hot loop).
      if (!this.closedByUser) {
        this.pollTimer = setTimeout(() => {
          if (!this.closedByUser) void this.startStream();
        }, POLL_INTERVAL_MS);
      }
    }
  }

  /** Parse satu JSON line dari stream, update offset, dispatch event. */
  private handleStreamLine(line: string): void {
    let update: CantonUpdate;
    try {
      update = JSON.parse(line) as CantonUpdate;
    } catch {
      this.logger.debug(`CantonUpdates: skip non-JSON line (${line.length} bytes)`);
      return;
    }

    // Update checkpoint SEBELUMLAH dispatch, supaya kalau crash mid-handle,
    // reconnect mulai dari offset yang sama (idempotensi di sisi handler).
    const offset =
      typeof update.offset === 'string'
        ? update.offset
        : update.offset?.absolute;
    if (offset) this.lastOffset = offset;

    const created: CreatedEventShape[] = [];
    const archived: ArchivedEventShape[] = [];
    for (const ev of update.events ?? []) {
      if ('created' in ev && ev.created) created.push(ev.created);
      else if ('archived' in ev && ev.archived) archived.push(ev.archived);
    }

    // Kumpulkan party yang visible event ini (dari eventsByIds mapping bila ada,
    // fallback ke signatories/observers/witnessParties).
    const parties = new Set<string>();
    for (const ev of update.eventsByIds ?? []) {
      if (ev?.party) parties.add(ev.party);
    }
    if (parties.size === 0) {
      for (const c of created) {
        c.signatories?.forEach((p) => parties.add(p));
        c.observers?.forEach((p) => parties.add(p));
      }
      for (const a of archived) a.witnessParties?.forEach((p) => parties.add(p));
    }

    if (created.length === 0 && archived.length === 0) return;

    this.updates$.next({
      offset: offset ?? this.lastOffset ?? '',
      updateId: update.updateId,
      parties: [...parties],
      created,
      archived,
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async getTokenSafe(): Promise<string | null> {
    try {
      return await this.keycloak.getAdminLedgerToken();
    } catch (err) {
      this.logger.error(`CantonUpdates: token fetch failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Ambil semua partyId user yang punya wallet real dari DB.
   * Skip placeholder (canquest:...) dan party kosong.
   * Dipakai untuk build filtersByParty map — refresh tiap connect supaya
   * user baru langsung ter-monitor.
   */
  private async loadUserParties(): Promise<string[]> {
    try {
      const users = await this.prisma.user.findMany({
        where: { cantonPartyId: { not: null } },
        select: { cantonPartyId: true },
      });
      return users
        .map((u) => u.cantonPartyId)
        .filter(
          (p): p is string =>
            !!p && !p.startsWith('canquest:') && p.includes('::'),
        );
    } catch (err) {
      this.logger.warn(`CantonUpdates: loadUserParties failed: ${String(err)}`);
      return [];
    }
  }

  /**
   * Ambil offset ledger terbaru (untuk start awal — hindari replay penuh).
   * Reuse CantonLedgerService.ledgerEnd() yang sudah proven + pakai auth yang
   * sama (Keycloak admin token via authHeaders()).
   *
   * Response shape: { offset: <string|number> } (flat, BUKAN nested .absolute).
   */
  private async fetchLedgerEnd(): Promise<string | undefined> {
    try {
      const end = (await this.ledger.ledgerEnd()) as {
        offset?: string | number;
      };
      const off = end?.offset;
      return off !== undefined && off !== null ? String(off) : undefined;
    } catch (err) {
      this.logger.warn(`CantonUpdates: ledgerEnd failed: ${String(err)}`);
      return undefined;
    }
  }

  private scheduleReconnect(err: Error): void {
    if (this.reconnectAttempts >= MAX_RECONNECTS) {
      this.logger.error(
        `CantonUpdates: giving up after ${MAX_RECONNECTS} attempts. ` +
          `Last error: ${err.message}. Poller existing tetap aktif sebagai fallback.`,
      );
      return;
    }
    this.reconnectAttempts++;
    const delay =
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    this.logger.warn(
      `CantonUpdates: reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECTS}). ` +
        `Reason: ${err.message}`,
    );
    setTimeout(() => {
      if (!this.closedByUser) void this.startStream();
    }, delay);
  }


}
