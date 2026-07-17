/**
 * CantonUpdatesService — realtime consumer untuk Canton JSON Ledger API
 * `/v2/updates` stream via WebSocket native.
 *
 * INSTEAD OF polling semua user setiap 30s (CcInboundSyncService) atau offer
 * setiap 60s (OfferReconcilerService), service ini subscribe ke stream ledger
 * SATU kali dengan token admin (CanReadAs semua party) lalu dispatch event
 * perubahan ke handler yang sesuai.
 *
 * ── Transport ────────────────────────────────────────────────────────────────
 * Canton `/v2/updates` adalah WebSocket native (bukan HTTP long-poll). Klien
 * konek ke `wss://ledger.../v2/updates` dengan subprotocol `daml.ws.auth`,
 * lalu kirim auth payload (`jwt.token.<token>`) sebagai message pertama,
 * diikuti subscription request JSON (beginExclusive + filter). Server stream
 * tiap update sebagai satu pesan JSON.
 *
 * Diverifikasi: Canton participant node v3.5.6 mendukung WS native di
 * `/v2/updates` (lihat asyncapi reference json-api-asyncapi-reference).
 *
 * ── Auth ─────────────────────────────────────────────────────────────────────
 * Single admin token via KeycloakTokenService.getAdminLedgerToken(). Token ini
 * punya CanReadAs untuk SEMUA party (di-grant saat allocateParty). Jadi 1 stream
 * cukup untuk pantau semua user. Tidak perlu token per-user.
 *
 * Token expire ~5 menit → KeycloakTokenService cache + pre-emptive refresh 60s
 * sebelum expiry. Saat reconnect, token baru otomatis di-fetch (selalu segar).
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
 *   - CreatedEvent untuk party receiver → push SSE `offer:new` ke frontend
 * Handler WAJIB idempoten (bisa dipanggil berkali-kali untuk event sama tanpa
 * double-effect) karena stream bisa re-deliver saat reconnect dari checkpoint.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Subject } from 'rxjs';
import WebSocket from 'ws';

import { KeycloakTokenService } from '../auth/keycloak-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CantonLedgerService } from './canton-ledger.service';
import { CcInboundSyncService } from './cc-inbound-sync.service';
import { OfferReconcilerService } from './offer-reconciler.service';

/**
 * Canton `/v2/updates` event shape (subset of fields kita pakai).
 * Lihat: https://docs.canton.network/reference/canton/json-api/ledger-endpoints
 *
 * Tiap "update" = satu top-level object yang server kirim sebagai satu WS
 * message. Berisi array of "events" (CreatedEvent | ArchivedEvent).
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
  /** Ledger offset (number) — untuk checkpoint & resume.
   *  Tipe number: AsyncAPI spec /v2/updates menolak string beginExclusive. */
  offset: number;
  updateId?: string;
  /** Party yang visible event ini (readAs). */
  parties: string[];
  created: CreatedEventShape[];
  archived: ArchivedEventShape[];
}

const MAX_RECONNECTS = 10;
const RECONNECT_BASE_DELAY_MS = 1_000;

@Injectable()
export class CantonUpdatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CantonUpdatesService.name);
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  /** Offset terakhir yang sukses diproses — resume dari sini saat reconnect.
   *  Tipe number: per AsyncAPI spec /v2/updates, beginExclusive WAJIB integer. */
  private lastOffset: number | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  /** Active WebSocket connection to Canton /v2/updates. */
  private ws: WebSocket | null = null;
  /** Inflight timer to detect connect timeout (stuck handshake). */
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Track party yang punya created event sejak flush reconcile terakhir —
   *  dipakai untuk emit SSE `offer:new` ke potential receiver (idempoten). */
  private readonly partyHadCreated = new Set<string>();

  /** Stream of parsed update events. Handler subscribe di onModuleInit. */
  readonly updates$ = new Subject<CantonUpdateEvent>();

  constructor(
    private readonly config: ConfigService,
    private readonly keycloak: KeycloakTokenService,
    private readonly ledger: CantonLedgerService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
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
    this.logger.log('CantonUpdatesService ENABLED — connecting WS to /v2/updates.');
  }

  /** Debounce timers per party — coalesce burst jadi 1 reconcile call. */
  private readonly partyDebounce = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly DEBOUNCE_MS = 2_000;

  /**
   * Dispatch satu update event: untuk tiap party yang visible, schedule
   * reconcile (balance + offer) dengan debounce. Non-blocking, error-tolerant.
   * Catat party yang punya created event untuk emit SSE `offer:new`.
   */
  private dispatchUpdate(ev: CantonUpdateEvent): void {
    const hasCreated = ev.created.length > 0;
    for (const partyId of ev.parties) {
      if (!partyId || partyId.startsWith('canquest:')) continue;
      if (hasCreated) this.partyHadCreated.add(partyId);
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

  /**
   * Reconcile satu party: balance sync + offer settlement, lalu emit SSE
   * `offer:new` kalau ada created event sejak flush terakhir. Non-fatal.
   */
  private async reconcileParty(partyId: string): Promise<void> {
    const hadCreated = this.partyHadCreated.has(partyId);
    this.partyHadCreated.delete(partyId);

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

    // Push SSE `offer:new` ke user (potential receiver) supaya frontend
    // invalidate list offer. Idempoten — frontend refetch & filter, tidak
    // duplikat. Hanya kirim kalau ada created event untuk party ini.
    if (hadCreated) {
      try {
        const user = await this.prisma.user.findFirst({
          where: { cantonPartyId: partyId },
          select: { id: true },
        });
        if (user) {
          this.realtime.push(user.id, 'offer:new', null);
        }
      } catch (err) {
        this.logger.warn(
          `CantonUpdates: offer:new push failed for ${partyId.slice(0, 12)}…: ${String(err)}`,
        );
      }
    }
  }

  onModuleDestroy(): void {
    this.closedByUser = true;
    this.teardownConnection();
    // Bersihkan debounce timers.
    for (const t of this.partyDebounce.values()) clearTimeout(t);
    this.partyDebounce.clear();
    this.updates$.complete();
  }

  /** Tutup WS aktif + clear connect timer. Aman dipanggil berulang. */
  private teardownConnection(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.ws) {
      // Lepas listener dulu supaya close() tidak trigger reconnect.
      this.ws.removeAllListeners();
      try {
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.close(1000, 'shutdown');
        }
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  /**
   * Build WS URL dari LEDGER_API_URL: https:// → wss://, http:// → ws://,
   * trailing slash sudah di-strip di constructor. Append `/v2/updates`.
   */
  private buildWsUrl(): string {
    let url = this.baseUrl;
    if (url.startsWith('https://')) url = 'wss://' + url.slice('https://'.length);
    else if (url.startsWith('http://')) url = 'ws://' + url.slice('http://'.length);
    return `${url}/v2/updates`;
  }

  /**
   * Start WebSocket subscription. Idempoten — aman dipanggil berkali-kali
   * (reconnect). Ambil offset terakhir (atau dari ledgerEnd kalau belum ada).
   *
   * Filter: WAJIB pakai filtersByParty dengan list party eksplisit (dari DB).
   * filtersForAnyParty butuh permission CanReadAsAnyParty yang admin token
   * TIDAK punya → HTTP 403 (verified). filter kosong → HTTP 400 (verified).
   *
   * Auth: subprotocol `daml.ws.auth`, lalu message pertama `jwt.token.<jwt>`.
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
    // Tipe WAJIB number — AsyncAPI spec /v2/updates menolak string (close 1000).
    let beginExclusive: number | undefined;
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

    const wasReconnecting = this.reconnectAttempts > 0;
    const wsUrl = this.buildWsUrl();
    if (wasReconnecting) {
      this.logger.log(
        `CantonUpdates: RECONNECT — WS ${wsUrl} for ${partyIds.length} party(ies) from offset=${beginExclusive}`,
      );
    } else {
      this.logger.verbose(
        `CantonUpdates: connecting WS ${wsUrl} for ${partyIds.length} party(ies) from offset=${beginExclusive}`,
      );
    }

    // Tutup koneksi lama (defensive — tidak boleh ada 2 WS bersamaan).
    this.teardownConnection();

    try {
      // Subprotocol `daml.ws.auth` WAJIB agar participant menegosiasikan WS
      // dengan mode auth. Tapi token TIDAK dilewat via subprotocol — reverse
      // proxy (Cloudflare/nginx) sering hanya meneruskan nilai pertama
      // Sec-WebSocket-Protocol, menjatuhkan `jwt.token.<jwt>` → participant
      // tidak pernah menerima token → UNAUTHENTICATED (grpcCodeValue:16).
      // Token dikirim sebagai WS message pertama (frame WS tidak disentuh proxy).
      this.ws = new WebSocket(wsUrl, 'daml.ws.auth');
    } catch (err) {
      if (this.closedByUser) return;
      this.scheduleReconnect(err as Error);
      return;
    }

    // Connect timeout: kalau handshake hang (network black-hole), abort lalu
    // reconnect. 15s cukup untuk handshake TLS+WS.
    this.connectTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
        this.logger.warn('CantonUpdates: WS connect timeout (15s) — reconnecting.');
        this.ws.emit('error', new Error('connect timeout'));
      }
    }, 15_000);

    const ws = this.ws;

    ws.on('open', () => {
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      if (this.closedByUser || this.ws !== ws) return;

      // Auth via WS message (bukan subprotocol) — frame WS tidak disentuh
      // reverse proxy (Cloudflare/nginx hanya meneruskan nilai pertama
      // Sec-WebSocket-Protocol). Format: `jwt.token.<jwt>`.
      ws.send(`jwt.token.${token}`);

      // Kirim subscription request SETELAH auth: beginExclusive (integer) +
      // filter + verbose. Tiap update akan datang sebagai WS message terpisah.
      const requestBody = {
        beginExclusive,
        filter: { filtersByParty },
        verbose: true,
      };
      // DIAGNOSTIK: log payload persis yang dikirim. Lepas setelah stabil.
      this.logger.log(
        `CantonUpdates: WS sending subscription request: ${JSON.stringify(requestBody)}`,
      );
      ws.send(JSON.stringify(requestBody));

      // Catatan: reconnectAttempts TIDAK di-reset di sini. Reset pindah ke
      // handleStreamLine() saat event valid pertama masuk (tanda subscription
      // benar-benar sukses). Kalau di-reset di open, close-1000 loop tidak
      // pernah capai MAX_RECONNECTS → infinite reconnect.
      if (wasReconnecting) {
        this.logger.log('CantonUpdates: WS connected (recovered).');
      } else {
        this.logger.log('CantonUpdates: WS connected.');
      }
    });

    // Tiap WS message = satu JSON object update. Parse langsung (tidak perlu
    // split newline seperti pada HTTP long-poll NDJSON).
    ws.on('message', (data: unknown) => {
      if (this.closedByUser || this.ws !== ws) return;
      const text =
        typeof data === 'string'
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data as Buffer[]).toString('utf8')
            : (data as Buffer).toString('utf8');
      // DIAGNOSTIK: log raw message (sebelum parse) supaya terlihat kalau
      // server kirim error JSON sebelum close. Lepas ini bisa dihapus.
      this.logger.log(
        `CantonUpdates: WS message received (${text.length} bytes): ${text.slice(0, 500)}`,
      );
      this.handleStreamLine(text);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (this.closedByUser) return;
      if (this.ws !== ws) return; // old socket, ignore
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      const reasonText = reason?.toString('utf8').slice(0, 200) ?? '';
      // 1000 = normal closure. Kalau muncul tepat setelah connect (belum ada
      // event masuk), tandanya participant menolak format subscription request.
      // Cek: beginExclusive harus integer (bukan string), filter valid.
      const suspectFormat = code === 1000 && this.reconnectAttempts === 0;
      this.logger.warn(
        `CantonUpdates: WS closed code=${code} reason=${reasonText}` +
          (suspectFormat
            ? ` [SUSPECT: subscription request ditolak — cek format beginExclusive (wajib integer) & filter]`
            : ''),
      );
      // 1008 = policy violation (sering: token expired/auth rejected). Reconnect
      // akan fetch token baru dari KeycloakTokenService.
      this.scheduleReconnect(new Error(`WS close code=${code}`));
    });

    ws.on('error', (err: Error) => {
      if (this.closedByUser) return;
      if (this.ws !== ws) return; // old socket, ignore
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      // Ekstrak HTTP status code dari error message `ws` library:
      // "Unexpected server response: <code>". Code 404/401/403 = masalah routing/
      // auth di reverse proxy ledger, BUKAN bug aplikasi. Log URL + hint agar
      // mudah diagnosa infrastruktur (nginx/Canton participant config).
      const statusMatch = err.message.match(/response:\s*(\d{3})/);
      const httpStatus = statusMatch ? statusMatch[1] : null;
      if (httpStatus === '404') {
        this.logger.error(
          `CantonUpdates: WS 404 — endpoint tidak ada di ${wsUrl}. ` +
            `Kemungkinan: (1) reverse proxy ${this.baseUrl} tidak forward WS Upgrade, ` +
            `(2) endpoint WS /v2/updates ada di host/port berbeda dari REST, ` +
            `(3) Canton participant node tidak enable WS. ` +
            `Akan OFF setelah ${MAX_RECONNECTS} attempts; poller existing jadi fallback.`,
        );
      } else if (httpStatus === '401' || httpStatus === '403') {
        this.logger.error(
          `CantonUpdates: WS ${httpStatus} — auth ditolak. Cek LEDGER_CLIENT_ID/SECRET & token scope daml_ledger_api.`,
        );
      } else {
        this.logger.error(`CantonUpdates: WS error: ${err.message}`);
      }
      // close handler akan trigger reconnect; kalau error terjadi pre-open tanpa
      // close event, force reconnect di sini sebagai safety net.
      if (
        ws.readyState === WebSocket.CLOSED ||
        ws.readyState === WebSocket.CLOSING
      ) {
        this.scheduleReconnect(err);
      }
    });
  }

  /** Parse satu JSON message dari WS, update offset, dispatch event. */
  private handleStreamLine(line: string): void {
    let update: CantonUpdate;
    try {
      update = JSON.parse(line) as CantonUpdate;
    } catch {
      this.logger.debug(`CantonUpdates: skip non-JSON message (${line.length} bytes)`);
      return;
    }

    // Update checkpoint SEBELUMLAH dispatch, supaya kalau crash mid-handle,
    // reconnect mulai dari offset yang sama (idempotensi di sisi handler).
    // Parse ke number — AsyncAPI spec /v2/updates menolak string beginExclusive.
    const offsetRaw =
      typeof update.offset === 'string'
        ? update.offset
        : update.offset?.absolute;
    if (offsetRaw !== undefined && offsetRaw !== null) {
      const offsetNum = Number(offsetRaw);
      if (Number.isFinite(offsetNum)) this.lastOffset = offsetNum;
    }
    const offset = this.lastOffset;

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

    // Event valid masuk = subscription sukses. Reset counter reconnect di sini
    // (BUKAN di ws.on('open')) supaya close-1000 loop bisa capai MAX & berhenti.
    this.reconnectAttempts = 0;

    this.updates$.next({
      offset: offset ?? this.lastOffset ?? 0,
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
   * Return number — per AsyncAPI spec /v2/updates, `beginExclusive` WAJIB
   * integer (bukan string). Kirim string → server close WS code 1000.
   */
  private async fetchLedgerEnd(): Promise<number | undefined> {
    try {
      const end = (await this.ledger.ledgerEnd()) as {
        offset?: string | number;
      };
      const off = end?.offset;
      if (off === undefined || off === null) return undefined;
      const num = typeof off === 'number' ? off : Number(off);
      return Number.isFinite(num) ? num : undefined;
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
