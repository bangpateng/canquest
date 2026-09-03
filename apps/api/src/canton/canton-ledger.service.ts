import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sleep } from '../common/time-utils';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { KeycloakTokenService } from '../auth/keycloak-token.service';
import {
  cantonPartyIdsEqual,
  normalizeCantonPartyId,
} from '../common/canton-party-id';
import { DEBUG_LEDGER } from '../common/debug-flags';
import { ProxyCacheService } from './proxy-cache.service';

/**
 * HTTP client for the Canton JSON Ledger API v2.
 *
 * Official Canton Network Documentation:
 *   https://docs.canton.network/appdev/modules/m4-json-api-tutorial
 *   https://docs.canton.network/appdev/modules/m4-backend-dev
 *   https://docs.canton.network/appdev/modules/m7-error-handling
 *
 * PROD setup (URL di-set via env var LEDGER_API_URL):
 *   LEDGER_API_URL=https://ledger.canquestlabs.com
 *   LEDGER_AUTH_MODE=keycloak
 *   LEDGER_API_ADMIN_USER=<UUID admin Keycloak>  (userId for submit / grant rights)
 *   Verify: curl https://ledger.canquestlabs.com/livez  → HTTP 200
 *
 * DEV setup (SSH tunnel to participant node):
 *   1. Get participant Docker IP on VPS 1:
 *      docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1
 *   2. Open SSH tunnel (keep terminal open):
 *      ssh -N -L 7575:<DOCKER_IP>:7575 user@VPS1_IP
 *   3. Set env: CANTON_JSON_API_URL=http://127.0.0.1:7575
 *   4. Verify: curl http://127.0.0.1:7575/livez  → HTTP 200
 *
 * JSON Ledger API endpoints used:
 *   POST /v2/parties                         — allocate a party
 *   POST /v2/commands/submit-and-wait        — create contracts / exercise choices
 *   GET  /v2/parties?parties=<id>            — verify a party exists
 *   POST /v2/users/{userId}/rights           — grant actAs / readAs rights
 *   GET  /v2/state/ledger-end               — current ledger offset
 *   POST /v2/state/active-contracts          — query ACS (active contract set)
 *   GET  /livez                              — health check
 *
 * Auth: Keycloak client_credentials (LEDGER_AUTH_MODE=keycloak) — the ONLY
 * supported mode. Legacy hs256/`CANTON_SPLICE_SECRET` removed; SpliceValidatorService
 * throws at boot if LEDGER_AUTH_MODE != keycloak.
 *
 * Error handling follows Module 7 patterns:
 *   - FAILED_PRECONDITION / ABORTED → contention → retry with backoff
 *   - NOT_FOUND                     → stale contract ID → re-query
 *   - INVALID_ARGUMENT              → bug in request payload → do not retry
 *   - PERMISSION_DENIED             → missing rights → check party grants
 */
@Injectable()
export class CantonLedgerService {
  private readonly logger = new Logger(CantonLedgerService.name);
  private readonly baseUrl: string;
  private readonly ledgerApiUser: string;
  /**
   * Scan API URL — hosts the Transfer Factory Registry (CIP-0056).
   * Required for executeTransferFactoryTransfer() to get factoryId + choiceContext.
   * Set via CANTON_SCAN_URL env var.
   */
  private readonly scanUrl: string | null;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly keycloak: KeycloakTokenService,
    @Optional() private readonly proxyCache: ProxyCacheService,
  ) {
    // LEDGER_API_URL wajib di prod (gateway publik ledger.canquestlabs.com).
    // Fallback ke CANTON_JSON_API_URL hanya untuk dev (SSH tunnel localhost:7575).
    // JANGAN pernah fallback ke localhost di produksi — itu menyembunyikan misconfig.
    const ledgerUrl =
      config.get<string>('LEDGER_API_URL') ||
      config.get<string>('CANTON_JSON_API_URL');
    if (!ledgerUrl) {
      throw new Error(
        'LEDGER_API_URL (atau CANTON_JSON_API_URL) belum diset — ' +
          'prod: https://ledger.canquestlabs.com',
      );
    }
    this.baseUrl = ledgerUrl.replace(/\/$/, '');
    // userId operator untuk submit commands / grant rights.
    // Prioritas: LEDGER_API_ADMIN_USER (UUID admin Keycloak) → CANTON_LEDGER_API_USER (legacy).
    this.ledgerApiUser =
      config.get<string>('LEDGER_API_ADMIN_USER') ||
      config.get<string>('CANTON_LEDGER_API_USER') ||
      'ledger-api-user';
    this.scanUrl =
      (config.get<string>('CANTON_SCAN_URL') ?? null)?.replace(/\/$/, '') ??
      null;
  }

  /**
   * Resolve the bearer token for a given ledger identity via Keycloak
   * client_credentials.
   *
   *   identity='admin'  → getAdminLedgerToken()  (validator-app-backend)
   *   identity='reward' → getRewardLedgerToken() (reward client, or same as admin)
   *
   * This is the single choke-point for ledger auth — all other methods call
   * authHeaders() which calls this helper.
   */
  private async getLedgerToken(
    identity: 'admin' | 'reward' = 'admin',
  ): Promise<string | null> {
    const mode = this.config.get<string>('LEDGER_AUTH_MODE');

    if (mode === 'keycloak') {
      if (!this.keycloak) {
        this.logger.error(
          'LEDGER_AUTH_MODE=keycloak but KeycloakTokenService is not injected. ' +
            'Ensure KeycloakTokenService is registered in CantonModule.',
        );
        return null;
      }
      try {
        return identity === 'reward'
          ? await this.keycloak.getRewardLedgerToken()
          : await this.keycloak.getAdminLedgerToken();
      } catch (err) {
        this.logger.error(
          `getLedgerToken(${identity}) Keycloak error: ${String(err)}`,
        );
        return null;
      }
    }

    // Only keycloak mode is supported. A missing/typo'd LEDGER_AUTH_MODE is a
    // config bug — failing loud here is far safer than silently returning no
    // token and sending unauthenticated ledger requests.
    throw new Error(
      `Unsupported LEDGER_AUTH_MODE="${mode ?? ''}". Set LEDGER_AUTH_MODE=keycloak.`,
    );
  }

  /**
   * Build HTTP headers for a Canton Ledger API request.
   *
   * @param identity - 'admin' (default) or 'reward' — selects the Keycloak
   *                   client_credentials identity.
   */
  private async authHeaders(
    identity: 'admin' | 'reward' = 'admin',
  ): Promise<Record<string, string>> {
    const token = await this.getLedgerToken(identity);
    if (!token) return { 'Content-Type': 'application/json' };
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Quick health check using the /livez endpoint.
   * Per Canton docs: http://localhost:7575/livez returns HTTP 200 when the
   * JSON Ledger API is healthy.
   * See: https://docs.canton.network/appdev/modules/m4-json-api-tutorial
   * Never throws — returns false on any error.
   */
  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/livez`, {
        signal: AbortSignal.timeout(4_000),
      });
      return res.ok;
    } catch (err) {
      this.logger.warn(
        `Canton JSON API not reachable at ${this.baseUrl}: ${String(err)}`,
      );
      return false;
    }
  }

  /**
   * Submit a command to the Canton JSON Ledger API v2 with retry on contention.
   *
   * Command body format per official Canton docs:
   * {
   *   "commands": [...],       <- FLAT top-level array (NOT nested)
   *   "userId": "...",
   *   "commandId": "uuid",     <- Used for deduplication
   *   "actAs": [...],
   *   "readAs": [...]
   * }
   *
   * Error handling per Module 7:
   *   - 409 FAILED_PRECONDITION/ABORTED (contention) → retry with exponential backoff
   *   - 404 NOT_FOUND                               → stale contract, do not retry
   *   - 400 INVALID_ARGUMENT                        → bug in payload, do not retry
   *   - 403 PERMISSION_DENIED                       → missing rights, do not retry
   *
   * Deduplication: each unique operation uses a stable commandId so that if the
   * same command is submitted twice (e.g. after a timeout), the ledger returns
   * the original result instead of executing twice.
   * See: https://docs.canton.network/appdev/modules/m7-error-handling
   */
  private async submitCommand(
    commands: unknown[],
    actAs: string[],
    userId?: string,
    /** Stable command ID for deduplication. Generates a UUID if not provided. */
    commandId?: string,
    /** AuthN identity: 'admin' (default) or 'reward' for dapp-reward token. */
    identity?: 'admin' | 'reward',
    /** Use transaction-tree endpoint when CreatedEvent contract ids are needed. */
    waitMode:
      | 'submit-and-wait'
      | 'submit-and-wait-for-transaction-tree' = 'submit-and-wait',
    /**
     * CIP-0056: Disclosed contracts from the Transfer Factory Registry.
     * Required for TransferFactory_Transfer — the ledger needs these to verify
     * contract visibility across participants.
     * See: https://docs.canton.network/appdev/deep-dives/explicit-contract-disclosure
     */
    disclosedContracts?: unknown[],
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const url = `${this.baseUrl}/v2/commands/${waitMode}`;
    const effectiveUserId = userId ?? this.ledgerApiUser;
    const effectiveCommandId = commandId ?? randomUUID();

    const MAX_RETRIES = 3;
    const RETRYABLE_STATUSES = new Set([408, 409, 429, 503]);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const body: Record<string, unknown> = {
          commands,
          userId: effectiveUserId,
          commandId: effectiveCommandId,
          actAs,
          readAs: actAs,
        };
        // CIP-0056: attach disclosed contracts when provided by the registry
        if (disclosedContracts && disclosedContracts.length > 0) {
          body.disclosedContracts = disclosedContracts;
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: await this.authHeaders(identity ?? 'admin'),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        const text = await res.text();

        // Success
        if (res.ok) return { ok: true, status: res.status, text };

        // Contention / transient errors → retry with exponential backoff
        // Per M7: FAILED_PRECONDITION = contract archived by competing tx
        if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 150; // 150ms, 300ms, 600ms
          this.logger.warn(
            `Command contention (attempt ${attempt + 1}/${MAX_RETRIES}) HTTP ${res.status} — retrying in ${delay}ms`,
          );
          await sleep(delay);
          continue;
        }

        return { ok: false, status: res.status, text };
      } catch (err) {
        if (attempt < MAX_RETRIES - 1) {
          const delay = Math.pow(2, attempt) * 150;
          this.logger.warn(
            `Command fetch error (attempt ${attempt + 1}): ${String(err)} — retrying in ${delay}ms`,
          );
          await sleep(delay);
          continue;
        }
        return { ok: false, status: 0, text: String(err) };
      }
    }

    return { ok: false, status: 0, text: 'Max retries exceeded' };
  }

  /**
   * Exercise a choice on a contract via the Canton JSON Ledger API v2.
   *
   * ExerciseCommand body per official docs:
   * {
   *   "ExerciseCommand": {
   *     "templateId": "<packageId>:<ModuleName>:<TemplateName>",
   *     "contractId": "<contractId>",
   *     "choice": "<ChoiceName>",
   *     "choiceArgument": { ... }
   *   }
   * }
   *
   * See: https://docs.canton.network/appdev/modules/m4-json-api-tutorial
   */
  /**
   * Exercise a choice and return { ok, status, text }.
   *
   * @param waitMode — use 'submit-and-wait-for-transaction-tree' when the choice
   *   returns a tuple (ContractId A, ContractId B) and you need to extract both
   *   contract IDs from the CreatedEvent tree. Default is 'submit-and-wait' which
   *   only returns the updateId (no contract IDs for multi-create choices).
   */
  async exerciseChoice(
    contractId: string,
    templateId: string,
    choiceName: string,
    choiceArgument: unknown,
    actAs: string[],
    commandId?: string,
    waitMode?: 'submit-and-wait' | 'submit-and-wait-for-transaction-tree',
    /** CIP-0056: disclosed contracts from Transfer Factory Registry */
    disclosedContracts?: unknown[],
  ): Promise<{ ok: boolean; status: number; text: string }> {
    return this.submitCommand(
      [
        {
          ExerciseCommand: {
            templateId,
            contractId,
            choice: choiceName,
            choiceArgument,
          },
        },
      ],
      actAs,
      undefined,
      commandId,
      undefined, // identity (defaults to 'admin')
      waitMode,
      disclosedContracts,
    );
  }

  /**
   * Call the Transfer Factory Registry (CIP-0056) to get factoryId + choiceContext.
   *
   * Branching:
   *   CC (Amulet/DSO) → Scan-proxy Splice (existing, unchanged)
   *   Non-CC (USDCx etc) → Utility Registry API (registrar-specific URL)
   *
   * Returns:
   *   - factoryId: contract ID of the TransferFactory to exercise
   *   - choiceContext.choiceContextData: goes into extraArgs.context
   *   - choiceContext.disclosedContracts: must be passed to submitCommand
   *   - transferKind: "direct" (preapproval) or "offer" (2-step)
   */
  async callTransferFactoryRegistry(
    choiceArguments: unknown,
    instrumentAdmin: string,
    /**
     * v29: token-standard registry version. 'v1' (default) = jalur lama
     * (executeTransferFactoryTransfer dkk — TIDAK lewat kontrak canquest).
     * 'v2' = TransferInstructionV2 (Account-based sender/receiver) — dipakai
     * quest Settle/ExecuteTransfer canquest-v29. Factory v2 di splice-node
     * 0.6.12 = ExternalPartyAmuletRules (implement interface V2).
     */
    version: 'v1' | 'v2' = 'v1',
  ): Promise<{
    factoryId: string;
    choiceContextData: Record<string, unknown>;
    disclosedContracts: unknown[];
    transferKind: string;
  } | null> {
    const isCc = this.isCcInstrumentAdmin(instrumentAdmin);
    const hostHeader =
      this.config.get<string>('CANTON_VALIDATOR_HOST_HEADER') ?? '';

    let url: string;
    if (isCc) {
      // CC path: Scan-proxy Splice.
      const validatorUrl = (
        this.config.get<string>('CANTON_VALIDATOR_URL') ??
        'http://127.0.0.1:8080'
      ).replace(/\/$/, '');
      const scanBase = `${validatorUrl}/api/validator/v0/scan-proxy`;
      url = `${scanBase}/registry/transfer-instruction/${version}/transfer-factory`;
    } else {
      // Non-CC path: Utility Registry API.
      const registryBase = (
        this.config.get<string>('UTILITY_REGISTRY_BASE_URL') ??
        'https://api.utilities.digitalasset.com'
      ).replace(/\/$/, '');
      const registrarPartyId = encodeURIComponent(instrumentAdmin);
      url = `${registryBase}/api/token-standard/v0/registrars/${registrarPartyId}/registry/transfer-instruction/${version}/transfer-factory`;
    }

    this.logger.debug(
      `Registry call: ${isCc ? 'CC' : 'Token'} admin=${instrumentAdmin.split('::')[0]}`,
    );

    try {
      const headers = await this.authHeaders();
      if (isCc && hostHeader) headers['Host'] = hostHeader;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ choiceArguments, excludeDebugFields: true }),
        signal: AbortSignal.timeout(20_000),
      });

      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(
          `Transfer Factory Registry ${res.status}: ${text.slice(0, 300)}`,
        );
        return null;
      }

      const data = JSON.parse(text) as {
        factoryId?: string;
        choiceContext?: {
          choiceContextData?: Record<string, unknown>;
          disclosedContracts?: unknown[];
        };
        transferKind?: string;
      };

      if (!data.factoryId || !data.choiceContext) {
        this.logger.warn(
          'Registry response missing factoryId or choiceContext',
        );
        return null;
      }

      this.logger.debug(
        `Registry OK: kind=${data.transferKind ?? 'unknown'} disclosed=${data.choiceContext.disclosedContracts?.length ?? 0}`,
      );

      return {
        factoryId: data.factoryId,
        choiceContextData: data.choiceContext.choiceContextData ?? {
          values: {},
        },
        disclosedContracts: data.choiceContext.disclosedContracts ?? [],
        transferKind: data.transferKind ?? 'unknown',
      };
    } catch (err) {
      this.logger.error(`Transfer Factory Registry error: ${String(err)}`);
      return null;
    }
  }

  /**
   * CIP-0056 Token Standard Transfer — the CORRECT flow.
   *
   * Replaces the legacy Splice REST createTransferOffer call.
   * Uses the Transfer Factory Registry (Scan API) to get the factory contract
   * and disclosed contracts, then exercises TransferFactory_Transfer.
   *
   * Flow per official reference CLI (canton-network/splice/token-standard/cli):
   *   1. Query ACS for sender's Amulet holdings → inputHoldingCids
   *   2. POST /registry/transfer-instruction/v1/transfer-factory
   *      → factoryId, choiceContext.choiceContextData, choiceContext.disclosedContracts
   *   3. Exercise TransferFactory_Transfer with:
   *      - contractId = factoryId (from registry, NOT from ACS)
   *      - extraArgs.context = choiceContext.choiceContextData
   *      - disclosedContracts passed to submitCommand
   *
   * Result:
   *   - transferKind = "direct" → CC transferred immediately (receiver has preapproval)
   *   - transferKind = "offer"  → AmuletTransferInstruction created (receiver must accept)
   *
   * @param senderPartyId - Sender's Canton party ID
   * @param receiverPartyId - Receiver's Canton party ID
   * @param amountCc - Amount in CC to transfer
   * @param description - Human-readable description (stored in meta)
   * @returns { ok, updateId, transferKind, error }
   */
  /**
   * M3 (signing relay): bangun command TransferFactory_Transfer TANPA submit.
   * Dipakai SigningRelayService untuk interactive submission — user external
   * menandatangani command yang identik dengan jalur custodial (CIP-0056).
   *
   * Langkah 1-3 sama dengan executeTransferFactoryTransfer (holdings →
   * choiceArguments → registry), tapi berhenti sebelum submit: caller yang
   * memutuskan submit custodial (exerciseChoice) atau interactive prepare.
   */
  async buildCip56TransferCommand(params: {
    senderPartyId: string;
    receiverPartyId: string;
    amountCc: number;
    description?: string;
    clientNonce?: string;
    /** Instrument token (default 'Amulet' = CC). Utk non-CC set bersama instrumentAdmin. */
    instrumentId?: string;
    /** Admin party instrument non-CC (dari token selector client / OneSwap). */
    instrumentAdmin?: string;
  }): Promise<
    | {
        ok: true;
        command: Record<string, unknown>;
        commandId: string;
        disclosedContracts: unknown[];
        transferKind: string;
      }
    | { ok: false; error: string }
  > {
    const {
      senderPartyId,
      receiverPartyId,
      amountCc,
      description,
      clientNonce,
      instrumentId = 'Amulet',
    } = params;

    const dsoParty = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '';
    const effectiveAdmin = params.instrumentAdmin || dsoParty;
    const isAmulet = instrumentId.toLowerCase() === 'amulet';
    if (!effectiveAdmin) {
      return { ok: false, error: 'instrumentAdmin/DSO party tidak diset' };
    }

    // Step 1: holdings pengirim — Amulet pakai query khusus; non-CC WAJIB
    // getTokenHoldingCids (InterfaceFilter) — mirror executeTransferFactoryTransfer.
    const holdings = isAmulet
      ? await this.queryAmuletHoldings(senderPartyId)
      : await this.getTokenHoldingCids(senderPartyId, instrumentId);
    if (holdings.length === 0) {
      return {
        ok: false,
        error: `Sender has no ${instrumentId} holdings — cannot fund transfer`,
      };
    }
    const inputHoldingCids = holdings.map((h) => h.contractId);

    const now = new Date();
    const choiceArguments: Record<string, unknown> = {
      expectedAdmin: effectiveAdmin,
      transfer: {
        sender: senderPartyId,
        receiver: receiverPartyId,
        amount: amountCc.toFixed(10),
        instrumentId: {
          admin: effectiveAdmin,
          id: instrumentId,
        },
        lock: null,
        requestedAt: now.toISOString(),
        executeBefore: new Date(
          now.getTime() + 24 * 60 * 60 * 1000,
        ).toISOString(),
        inputHoldingCids,
        meta: {
          values: description
            ? { 'splice.lfdecentralizedtrust.org/reason': description }
            : {},
        },
      },
      extraArgs: {
        context: { values: {} }, // diisi registry choiceContextData di bawah
        meta: { values: {} },
      },
    };

    // Step 2: Transfer Factory Registry — CC via Scan-proxy; non-CC via
    // Utility Registry (callTransferFactoryRegistry bercabang otomatis).
    const registry = await this.callTransferFactoryRegistry(
      choiceArguments,
      effectiveAdmin,
    );
    if (!registry) {
      return {
        ok: false,
        error: 'Transfer Factory Registry call failed — check CANTON_SCAN_URL',
      };
    }
    (choiceArguments.extraArgs as Record<string, unknown>).context =
      registry.choiceContextData;

    // Step 3: susun ExerciseCommand + commandId deterministik (dedup nonce).
    const factoryInterfaceId =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';
    const commandId = clientNonce
      ? `tf-${createHash('sha256')
          .update(
            `${senderPartyId}|${receiverPartyId}|${amountCc.toFixed(10)}|${clientNonce}`,
          )
          .digest('hex')
          .slice(0, 32)}`
      : `relay-tf-${randomUUID().slice(0, 24)}`;

    return {
      ok: true,
      command: {
        ExerciseCommand: {
          templateId: factoryInterfaceId,
          contractId: registry.factoryId,
          choice: 'TransferFactory_Transfer',
          choiceArgument: choiceArguments,
        },
      },
      commandId,
      disclosedContracts: registry.disclosedContracts,
      transferKind: registry.transferKind,
    };
  }

  async executeTransferFactoryTransfer(params: {
    senderPartyId: string;
    receiverPartyId: string;
    amountCc: number;
    description?: string;
    /**
     * Ledger identity to use for authentication.
     * 'admin'  → validator-app-backend (general operations, default)
     * 'reward' → reward client (CC reward transfers — JOB_SEND_CC_REWARD)
     */
    identity?: 'admin' | 'reward';
    /**
     * Idempotency nonce dari client (UUID per Send click). Kalau diset, commandId
     * ledger jadi DETERMINISTIK (hash dari sender+receiver+amount+nonce) → Canton
     * dedup dua submit dengan nonce sama menjadi SATU transfer. Mencegah double-send
     * akibat retry/double-click/multi-tab. Wajib untuk operasi user-initiated (sendCc).
     */
    clientNonce?: string;
    /**
     * Instrument id token (default 'Amulet' = CC). Untuk transfer non-CC
     * (USDCx, CBTC, dll), set instrumentId + instrumentAdmin.
     */
    instrumentId?: string;
    /** Admin party instrument (default CANTON_DSO_PARTY_ID = admin CC/Amulet). */
    instrumentAdmin?: string;
  }): Promise<{
    ok: boolean;
    updateId: string | null;
    transferKind: string;
    transferInstructionCid?: string | null;
    error?: string;
  }> {
    const {
      senderPartyId,
      receiverPartyId,
      amountCc,
      description,
      identity = 'admin',
      clientNonce,
      instrumentId = 'Amulet',
    } = params;

    // DSO party (admin CC/Amulet) — dari CANTON_DSO_PARTY_ID. Untuk non-CC,
    // admin di-resolve dari OneSwap listTokens() (instrumentAdmin param).
    const dsoParty =
      this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '';
    const effectiveAdmin = params.instrumentAdmin || dsoParty;
    const isAmulet = instrumentId.toLowerCase() === 'amulet';
    if (isAmulet && !dsoParty) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error:
          'CANTON_DSO_PARTY_ID is not set — required for CIP-0056 transfer',
      };
    }
    if (!effectiveAdmin) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: `instrumentAdmin required for ${instrumentId} transfer`,
      };
    }

    // ── Step 1: Query sender's holdings for inputHoldingCids ───────────
    // Dispatch: Amulet pakai queryAmuletHoldings (struktur khusus). Non-CC
    // (USDCx dll) WAJIB pakai getTokenHoldingCids (InterfaceFilter) — bukan
    // queryTokenHoldings (WildcardFilter) yang return [] untuk interface-only
    // contract. Itu root cause swap CC→USDCx delivery gagal selama ini.
    const holdings = isAmulet
      ? await this.queryAmuletHoldings(senderPartyId)
      : await this.getTokenHoldingCids(senderPartyId, instrumentId);
    if (holdings.length === 0) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: `Sender has no ${instrumentId} holdings — cannot fund transfer`,
      };
    }
    const inputHoldingCids = holdings.map((h) => h.contractId);

    const now = new Date();
    const amountNumeric = amountCc.toFixed(10);

    // ── Build choiceArguments per CIP-0056 spec ──────────────────────────
    // Reference: canton-network/splice/token-standard/cli/src/commands/transfer.ts
    const choiceArguments: Record<string, unknown> = {
      expectedAdmin: effectiveAdmin,
      transfer: {
        sender: senderPartyId,
        receiver: receiverPartyId,
        amount: amountNumeric,
        instrumentId: {
          admin: effectiveAdmin,
          id: instrumentId,
        },
        lock: null,
        requestedAt: now.toISOString(),
        executeBefore: new Date(
          now.getTime() + 24 * 60 * 60 * 1000,
        ).toISOString(),
        inputHoldingCids,
        meta: {
          values: description
            ? { 'splice.lfdecentralizedtrust.org/reason': description }
            : {},
        },
      },
      extraArgs: {
        context: { values: {} }, // Will be replaced with registry's choiceContextData
        meta: { values: {} },
      },
    };

    // ── Step 2: Call Transfer Factory Registry ───────────────────────────
    const registry = await this.callTransferFactoryRegistry(
      choiceArguments,
      effectiveAdmin,
    );
    if (!registry) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'Transfer Factory Registry call failed — check CANTON_SCAN_URL',
      };
    }

    // Inject choiceContextData into extraArgs.context (per reference CLI)
    (choiceArguments.extraArgs as Record<string, unknown>).context =
      registry.choiceContextData;

    // ── Step 3: Exercise TransferFactory_Transfer ────────────────────────
    const factoryInterfaceId =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';

    // commandId DETERMINISTIK kalau clientNonce diset → Canton dedup replay jadi 1 transfer.
    // Tanpa nonce (reward/job path) fallback ke randomUUID (operasi background unik per run).
    const commandId = clientNonce
      ? `tf-${createHash('sha256')
          .update(
            `${senderPartyId}|${receiverPartyId}|${amountCc.toFixed(10)}|${clientNonce}`,
          )
          .digest('hex')
          .slice(0, 32)}`
      : `transfer-factory-${senderPartyId.slice(0, 12)}-${randomUUID().slice(0, 16)}`;

    this.logger.log(
      `TransferFactory_Transfer (CIP-0056): sender=${senderPartyId.split('::')[0]} → ` +
        `receiver=${receiverPartyId.split('::')[0]} amount=${amountCc} ${instrumentId} ` +
        `kind=${registry.transferKind} factory=${registry.factoryId.slice(0, 16)}... ` +
        `disclosed=${registry.disclosedContracts.length} identity=${identity}`,
    );

    const { ok, status, text } = await this.exerciseChoice(
      registry.factoryId,
      factoryInterfaceId,
      'TransferFactory_Transfer',
      choiceArguments,
      [senderPartyId],
      commandId,
      'submit-and-wait-for-transaction-tree',
      registry.disclosedContracts, // CIP-0056: pass disclosed contracts
    );

    if (ok) {
      let updateId: string | null = null;
      let transferInstructionCid: string | null = null;
      try {
        // updateId nested di transactionTree.updateId (bukan root) — lihat
        // extractUpdateIdFromTree. parsed dipakai untuk extract contract id offer.
        const parsed = JSON.parse(text);
        updateId = extractUpdateIdFromTree(text);
        // If transferKind = "offer", extract the TransferInstruction contract ID
        // from the CreatedEvent tree for the receiver to accept later
        if (registry.transferKind === 'offer') {
          transferInstructionCid = extractCreatedContractId(text);
        }
        void parsed; // dipertahankan untuk debugging masa depan bila perlu
      } catch {
        /* ignore */
      }

      this.logger.log(
        `TransferFactory_Transfer OK: kind=${registry.transferKind} ` +
          `updateId=${updateId?.slice(0, 16) ?? 'unknown'} ` +
          (transferInstructionCid
            ? `instructionCid=${transferInstructionCid.slice(0, 16)}...`
            : ''),
      );
      return {
        ok: true,
        updateId,
        transferKind: registry.transferKind,
        transferInstructionCid,
      };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(`TransferFactory_Transfer failed ${status}: ${errMsg}`);
    return {
      ok: false,
      updateId: null,
      transferKind: registry.transferKind,
      error: errMsg,
    };
  }

  /**
   * Feature flag: true kalau transfer harus via WalletUserProxy (bukan direct
   * TransferFactory_Transfer). Path lama tetap aktif kalau false / unset, jadi
   * ini safe incremental rollout di mainnet.
   */
  get useWalletProxy(): boolean {
    const v = this.config.get<string>('USE_WALLET_PROXY');
    return v === 'true' || v === '1';
  }

  /**
   * Feature flag OFFERS: true HANYA kalau USE_WALLET_PROXY on DAN FeaturedAppRight
   * sudah ada (env override CANTON_PROXY_FAR_CID atau query ACS ada hasil).
   *
   * Beda dgn transfer: offers proxy choices (Accept/Reject/Withdraw) butuh
   * featuredAppRightCid WAJIB — tidak ada fallback BatchTransfer. Jadi kalau
   * FAR belum approve Canton Foundation, offers TETAP via path lama.
   *
   * Async karena butuh cek ProxyCacheService (refresh cache kalau perlu).
   */
  async useWalletProxyForOffers(): Promise<boolean> {
    if (!this.useWalletProxy) return false;
    if (!this.proxyCache) return false;
    // Cek env override dulu (sync, cepat)
    const envFar = this.config.get<string>('CANTON_PROXY_FAR_CID');
    if (envFar) return true;
    // Cek cache (refresh kalau basi)
    const farCid = await this.proxyCache.getFeaturedAppRightCid();
    return Boolean(farCid);
  }

  /**
   * Execute transfer via WalletUserProxy_TransferFactory_Transfer.
   *
   * DAML reference: choice controller = `user` party (proxyArg.user). Signatory
   * of WalletUserProxy = provider (app-canquest). Jadi submit butuh:
   *   - actAs: [userParty]            ← user authorize
   *   - contractId: WalletUserProxy   ← provider's proxy
   *   - proxyArg.featuredAppRightCid: FeaturedAppRight (opsional — tanpa ini
   *     transfer jalan tapi tidak earn CC rewards)
   *
   * Internal DAML memanggil TransferFactory_Transfer (sama dgn path lama), jadi
   * event stream /v2/updates akan fire event yg sama → cc-inbound-sync /
   * balance-event-handler tetap realtime tanpa modifikasi.
   *
   * Fallback: kalau ProxyCacheService belum di-inject atau contractId kosong,
   * return error agar caller (party.controller) fallback ke path lama.
   *
   * @see https://docs.canton.network/sdks-tools/api-reference/splice-daml/splice-util-featured-app-proxies/splice-util-featuredapp-walletuserproxy
   */
  async executeProxyTransfer(params: {
    userPartyId: string;
    receiverPartyId: string;
    amount: number;
    description?: string;
    clientNonce?: string;
    instrumentId?: string;
    instrumentAdmin?: string;
  }): Promise<{
    ok: boolean;
    updateId: string | null;
    transferKind: string;
    transferInstructionCid?: string | null;
    error?: string;
  }> {
    // Guard: ProxyCacheService harus ter-inject + contractId tersedia.
    if (!this.proxyCache) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'ProxyCacheService not injected — proxy transfer unavailable',
      };
    }
    const wupCid = await this.proxyCache.getWalletUserProxyCid();
    if (!wupCid) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error:
          'WalletUserProxy contractId not found — run setup (FASE 2) or set CANTON_PROXY_WUP_CID',
      };
    }
    // FeaturedAppRight opsional: tanpa ini transfer jalan tapi tanpa CC rewards.
    // AUTO-ROUTE: kalau FAR kosong, fallback ke BatchTransfer (optFeaturedAppRightCid=null)
    // supaya transfer tetap via proxy walau Canton Foundation belum approve FAR.
    // Begitu FAR ada, single TransferFactory_Transfer dipakai (utk earn rewards).
    const farCid = await this.proxyCache.getFeaturedAppRightCid();
    if (!farCid) {
      this.logger.log(
        'executeProxyTransfer: FeaturedAppRight belum ada → fallback BatchTransfer (no rewards)',
      );
      return this.executeProxyBatchTransfer(params);
    }

    const {
      userPartyId,
      receiverPartyId,
      amount,
      description,
      clientNonce,
      instrumentId = 'Amulet',
    } = params;

    // DSO party (admin CC/Amulet). Untuk non-CC, di-resolve dari instrumentAdmin.
    const dsoParty =
      this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '';
    const effectiveAdmin = params.instrumentAdmin || dsoParty;
    const isAmulet = instrumentId.toLowerCase() === 'amulet';
    if (isAmulet && !dsoParty) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'CANTON_DSO_PARTY_ID not set',
      };
    }
    if (!effectiveAdmin) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: `instrumentAdmin required for ${instrumentId}`,
      };
    }

    // ── Resolve transfer factory + choiceContext (sama dgn path lama) ───
    // Registry call tetap perlu: factoryId + disclosedContracts + transferKind
    // (proxy membungkus TransferFactory_Transfer, bukan menggantikan registry).
    const now = new Date();
    const amountNumeric = amount.toFixed(10);
    const choiceContextTransfer = {
      sender: userPartyId,
      receiver: receiverPartyId,
      amount: amountNumeric,
      instrumentId: { admin: effectiveAdmin, id: instrumentId },
      lock: null,
      requestedAt: now.toISOString(),
      executeBefore: new Date(
        now.getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      inputHoldingCids: [], // proxy resolve sendiri via DAML
      meta: {
        values: description
          ? { 'splice.lfdecentralizedtrust.org/reason': description }
          : {},
      },
    };

    const registry = await this.callTransferFactoryRegistry(
      {
        expectedAdmin: effectiveAdmin,
        transfer: choiceContextTransfer,
        extraArgs: {
          context: { values: {} },
          meta: { values: {} },
        },
      },
      effectiveAdmin,
    );
    if (!registry) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'Transfer Factory Registry call failed',
      };
    }

    // ── Construct proxy choice argument ─────────────────────────────────
    // WalletUserProxy_TransferFactory_Transfer args:
    //   { cid: factoryId, proxyArg: { user, choiceArg: {...}, featuredAppRightCid } }
    // choiceArg = arg TransferFactory_Transfer (root-level), BUKAN hanya `transfer`.
    // Field wajib (root level choiceArg): expectedAdmin, transfer, extraArgs.
    // Registry mengisi extraArgs.context (choiceContextData) — sama dgn path lama.
    const proxyArg: Record<string, unknown> = {
      user: userPartyId,
      choiceArg: {
        expectedAdmin: effectiveAdmin,
        transfer: {
          sender: userPartyId,
          receiver: receiverPartyId,
          amount: amountNumeric,
          instrumentId: { admin: effectiveAdmin, id: instrumentId },
          lock: null,
          requestedAt: now.toISOString(),
          executeBefore: new Date(
            now.getTime() + 24 * 60 * 60 * 1000,
          ).toISOString(),
          inputHoldingCids: [], // proxy handles
          meta: {
            values: description
              ? { 'splice.lfdecentralizedtrust.org/reason': description }
              : {},
          },
        },
        extraArgs: {
          context: registry.choiceContextData, // dari registry (choiceContextData)
          meta: { values: {} },
        },
      },
      featuredAppRightCid: farCid ?? '',
    };

    // commandId deterministik kalau clientNonce diset (dedup ledger).
    const commandId = clientNonce
      ? `proxy-tf-${createHash('sha256')
          .update(
            `${userPartyId}|${receiverPartyId}|${amount.toFixed(10)}|${clientNonce}`,
          )
          .digest('hex')
          .slice(0, 32)}`
      : `proxy-transfer-${userPartyId.slice(0, 12)}-${randomUUID().slice(0, 16)}`;

    // Disclosed contracts: FeaturedAppRight + WalletUserProxy + registry contracts.
    // WalletUserProxy harus didisclose supaya user party bisa exercise choice
    // (WUP signatory=provider, user=controller, user bukan signatory → need disclosure).
    const wupDisclosure =
      await this.proxyCache.getWalletUserProxyDisclosedContract();
    const farDisclosure =
      await this.proxyCache.getFeaturedAppRightDisclosedContract();
    const disclosedContracts: unknown[] = [
      ...registry.disclosedContracts,
      ...(wupDisclosure ? [wupDisclosure] : []),
      ...(farDisclosure ? [farDisclosure] : []),
    ];

    this.logger.log(
      `WalletUserProxy_TransferFactory_Transfer: user=${userPartyId.split('::')[0]} → ` +
        `receiver=${receiverPartyId.split('::')[0]} amount=${amount} ${instrumentId} ` +
        `kind=${registry.transferKind} factory=${registry.factoryId.slice(0, 16)}... ` +
        `wup=${wupCid.slice(0, 16)}... far=${farCid ? farCid.slice(0, 16) + '...' : 'none'}`,
    );

    const { ok, status, text } = await this.exerciseChoice(
      wupCid,
      this.proxyCache.wupTemplateId,
      'WalletUserProxy_TransferFactory_Transfer',
      { cid: registry.factoryId, proxyArg },
      [userPartyId], // controller = user party
      commandId,
      'submit-and-wait-for-transaction-tree',
      disclosedContracts,
    );

    if (ok) {
      const updateId = extractUpdateIdFromTree(text);
      let transferInstructionCid: string | null = null;
      if (registry.transferKind === 'offer') {
        transferInstructionCid = extractCreatedContractId(text);
      }
      this.logger.log(
        `Proxy transfer OK: kind=${registry.transferKind} ` +
          `updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
      );
      return {
        ok: true,
        updateId,
        transferKind: registry.transferKind,
        transferInstructionCid,
      };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(
      `WalletUserProxy_TransferFactory_Transfer failed ${status}: ${errMsg}`,
    );
    return {
      ok: false,
      updateId: null,
      transferKind: registry.transferKind,
      error: errMsg,
    };
  }

  /**
   * Execute transfer via WalletUserProxy_BatchTransfer.
   *
   * BERBEDA dgn executeProxyTransfer (single): BatchTransfer punya
   * `optFeaturedAppRightCid: Optional` → bisa `null` tanpa FeaturedAppRight.
   * Docs: "Optional so the batched choice can be used without a featured app right."
   *
   * Untuk SINGLE transfer (transferCalls.length === 1), BatchTransfer setara
   * dgn TransferFactory_Transfer tapi tanpa syarat FAR. Jadi BISA JALAN
   * sebelum Canton Foundation approve FeaturedAppRight (mode tanpa CC rewards).
   *
   * Begitu FAR approve, executeProxyTransfer() dipakai (optFeatureAppRightCid
   * Some(cid) → earn CC rewards).
   *
   * DAML reference:
   *   choice WalletUserProxy_BatchTransfer
   *   controller = getFirstSender(transferCalls) = sender party transfer[0]
   *   args: {
   *     transferCalls: [{ factoryCid, choiceArg }],
   *     optFeaturedAppRightCid: null | { Some: cid }
   *   }
   *
   * @see docs/WALLET_USER_PROXY_SETUP.md FASE 4b
   */
  async executeProxyBatchTransfer(params: {
    userPartyId: string;
    receiverPartyId: string;
    amount: number;
    description?: string;
    clientNonce?: string;
    instrumentId?: string;
    instrumentAdmin?: string;
  }): Promise<{
    ok: boolean;
    updateId: string | null;
    transferKind: string;
    transferInstructionCid?: string | null;
    error?: string;
  }> {
    if (!this.proxyCache) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'ProxyCacheService not injected — proxy transfer unavailable',
      };
    }
    const wupCid = await this.proxyCache.getWalletUserProxyCid();
    if (!wupCid) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error:
          'WalletUserProxy contractId not found (set CANTON_PROXY_WUP_CID)',
      };
    }
    // FAR opsional — kalau ada, attach (Some) utk earn rewards. Kalau kosong,
    // null (None) — transfer jalan tanpa CC rewards.
    const farCid = await this.proxyCache.getFeaturedAppRightCid();

    const {
      userPartyId,
      receiverPartyId,
      amount,
      description,
      clientNonce,
      instrumentId = 'Amulet',
    } = params;

    const dsoParty =
      this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '';
    const effectiveAdmin = params.instrumentAdmin || dsoParty;
    const isAmulet = instrumentId.toLowerCase() === 'amulet';
    if (isAmulet && !dsoParty) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'CANTON_DSO_PARTY_ID not set',
      };
    }
    if (!effectiveAdmin) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: `instrumentAdmin required for ${instrumentId}`,
      };
    }

    const now = new Date();
    const amountNumeric = amount.toFixed(10);

    // ── Query sender's holdings for inputHoldingCids ────────────────────
    // Sama dgn path lama (line 536): proxy choice TETAP butuh inputHoldingCids
    // di choiceArg.transfer — DAMAL ga auto-resolve holdings sender.
    // Tanpa ini → DAML_FAILURE "At least one holding must be provided".
    const holdings = isAmulet
      ? await this.queryAmuletHoldings(userPartyId)
      : await this.getTokenHoldingCids(userPartyId, instrumentId);
    if (holdings.length === 0) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: `Sender has no ${instrumentId} holdings — cannot fund proxy transfer`,
      };
    }
    const inputHoldingCids = holdings.map((h) => h.contractId);

    // ── Resolve transfer factory + choiceContext (sama dgn single path) ──
    const choiceContextTransfer = {
      sender: userPartyId,
      receiver: receiverPartyId,
      amount: amountNumeric,
      instrumentId: { admin: effectiveAdmin, id: instrumentId },
      lock: null,
      requestedAt: now.toISOString(),
      executeBefore: new Date(
        now.getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      inputHoldingCids,
      meta: {
        values: description
          ? { 'splice.lfdecentralizedtrust.org/reason': description }
          : {},
      },
    };

    const registry = await this.callTransferFactoryRegistry(
      {
        expectedAdmin: effectiveAdmin,
        transfer: choiceContextTransfer,
        extraArgs: { context: { values: {} }, meta: { values: {} } },
      },
      effectiveAdmin,
    );
    if (!registry) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'Transfer Factory Registry call failed',
      };
    }

    // ── Construct BatchTransfer choice argument ──────────────────────────
    // transferCalls = array 1 elemen (single transfer, pakai BatchTransfer
    // cuma untuk bypass FAR requirement).
    const choiceArg = {
      expectedAdmin: effectiveAdmin,
      transfer: {
        sender: userPartyId,
        receiver: receiverPartyId,
        amount: amountNumeric,
        instrumentId: { admin: effectiveAdmin, id: instrumentId },
        lock: null,
        requestedAt: now.toISOString(),
        executeBefore: new Date(
          now.getTime() + 24 * 60 * 60 * 1000,
        ).toISOString(),
        inputHoldingCids,
        meta: {
          values: description
            ? { 'splice.lfdecentralizedtrust.org/reason': description }
            : {},
        },
      },
      extraArgs: {
        context: registry.choiceContextData,
        meta: { values: {} },
      },
    };

    // optFeaturedAppRightCid: DAML-LF JSON Optional = nullable (BUKAN variant).
    //   Some cid → cid (raw string)
    //   None     → null
    // Bukti: Transfer.lock (Optional Lock) pakai null & ledger ACCEPT.
    // BUG LAMA: {tags:'Some',value:cid} / {tag:'Some',value:cid} → salah,
    // Optional bukan variant. Fix: raw value / null.
    const optFar = farCid ?? null;

    const choiceArgument = {
      transferCalls: [
        {
          factoryCid: registry.factoryId,
          choiceArg,
        },
      ],
      optFeaturedAppRightCid: optFar,
    };

    const commandId = clientNonce
      ? `proxy-batch-${createHash('sha256')
          .update(
            `${userPartyId}|${receiverPartyId}|${amount.toFixed(10)}|${clientNonce}`,
          )
          .digest('hex')
          .slice(0, 32)}`
      : `proxy-batch-${userPartyId.slice(0, 12)}-${randomUUID().slice(0, 16)}`;

    this.logger.log(
      `WalletUserProxy_BatchTransfer: user=${userPartyId.split('::')[0]} → ` +
        `receiver=${receiverPartyId.split('::')[0]} amount=${amount} ${instrumentId} ` +
        `kind=${registry.transferKind} factory=${registry.factoryId.slice(0, 16)}... ` +
        `wup=${wupCid.slice(0, 16)}... far=${farCid ? 'attached' : 'None (no reward)'}`,
    );

    // Disclosed contracts: WUP (wajib — user butuh lihat WUP utk exercise) +
    // FAR (kalau ada) + registry contracts (TransferRule etc).
    // Tanpa WUP disclosure → DAMAL reject CONTRACT_NOT_FOUND.
    const wupDisclosure =
      await this.proxyCache.getWalletUserProxyDisclosedContract();
    const farDisclosure =
      await this.proxyCache.getFeaturedAppRightDisclosedContract();
    const disclosedContracts: unknown[] = [
      ...registry.disclosedContracts,
      ...(wupDisclosure ? [wupDisclosure] : []),
      ...(farDisclosure ? [farDisclosure] : []),
    ];

    const { ok, status, text } = await this.exerciseChoice(
      wupCid,
      this.proxyCache.wupTemplateId,
      'WalletUserProxy_BatchTransfer',
      choiceArgument,
      [userPartyId], // controller = getFirstSender = sender party
      commandId,
      'submit-and-wait-for-transaction-tree',
      disclosedContracts,
    );

    if (ok) {
      const updateId = extractUpdateIdFromTree(text);
      let transferInstructionCid: string | null = null;
      if (registry.transferKind === 'offer') {
        transferInstructionCid = extractCreatedContractId(text);
      }
      this.logger.log(
        `Proxy batch transfer OK: kind=${registry.transferKind} ` +
          `updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
      );
      return {
        ok: true,
        updateId,
        transferKind: registry.transferKind,
        transferInstructionCid,
      };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(
      `WalletUserProxy_BatchTransfer failed ${status}: ${errMsg}`,
    );
    return {
      ok: false,
      updateId: null,
      transferKind: registry.transferKind,
      error: errMsg,
    };
  }

  /**
   * Execute ATOMIC multi-leg transfer via WalletUserProxy_BatchTransfer.
   *
   * Pattern ini adalah NATIVE Splice utk atomic multi-receiver dari sender pool
   * yang sama. Berbeda dgn 2x TransferFactory_Transfer terpisah (yang gagal krn
   * Leg 1 consume amulet → Leg 2 CONTRACT_NOT_ACTIVE), BatchTransfer THREADING
   * holdings secara internal:
   *
   *   1. Leg 1 (transfer) execute → dapat senderChangeCids (change amulet)
   *   2. HoldingMap simpan change per instrumentId
   *   3. Leg 2 (fee) execute dgn actualInputHoldingCids = original + change
   *
   * Source: Splice.Util.FeaturedApp.WalletUserProxy.daml executeTransferCalls
   *   let actualInputHoldingCids = tf.inputHoldingCids ++ change dari holdingMap
   *   let newHoldingMap = M.insert instrumentId result.senderChangeCids holdingMap
   *
   * Use case: Send Token/CC atomic (transfer utama + platform fee dalam 1 tx).
   *
   * actAs: [senderParty] (controller = getFirstSender)
   */
  async executeProxyBatchTransferMulti(params: {
    senderPartyId: string;
    transfers: Array<{
      receiverPartyId: string;
      amount: number;
      instrumentId: string; // 'Amulet' (CC) atau token id (USDCx)
      instrumentAdmin: string; // DSO utk CC, registrar utk non-CC
      description?: string;
    }>;
    clientNonce?: string;
  }): Promise<{
    ok: boolean;
    updateId: string | null;
    transferKind: string;
    transferInstructionCid?: string | null;
    error?: string;
  }> {
    if (!this.proxyCache) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'ProxyCacheService not injected — proxy transfer unavailable',
      };
    }
    const wupCid = await this.proxyCache.getWalletUserProxyCid();
    if (!wupCid) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error:
          'WalletUserProxy contractId not found (set CANTON_PROXY_WUP_CID)',
      };
    }
    const farCid = await this.proxyCache.getFeaturedAppRightCid();
    const { senderPartyId, transfers, clientNonce } = params;
    if (transfers.length === 0) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'No transfers provided',
      };
    }

    const now = new Date();
    const executeBefore = new Date(
      now.getTime() + 24 * 3600 * 1000,
    ).toISOString();
    const nowIso = now.toISOString();

    // ── Build transferCalls array ─────────────────────────────────────────
    // GROUP BY INSTRUMENT (admin + id): panggil registry SEKALI per instrument,
    // bukan per-leg. Factory + disclosed contracts adalah per-instrument.
    // Kalau panggil registry 2x utk instrument sama (mis. 2 leg CC Amulet),
    // factory contract conflict → CONTRACT_NOT_FOUND saat exercise BatchTransfer.
    //
    // BatchTransfer design: setiap transferCall boleh beda receiver, tapi
    // factory untuk instrument yang sama adalah identik. Reuse = aman.
    const instrumentRegistries = new Map<
      string, // key = `${admin}|${id}`
      {
        factoryId: string;
        choiceContextData: Record<string, unknown>;
        disclosedContracts: unknown[];
        transferKind: string;
      }
    >();
    const allDisclosedContracts: unknown[] = [];
    let lastTransferKind = 'direct';

    const transferCalls: Array<{
      factoryCid: string;
      choiceArg: Record<string, unknown>;
    }> = [];

    for (const t of transfers) {
      const instrumentKey = `${t.instrumentAdmin}|${t.instrumentId}`;
      // Resolve registry utk instrument ini (cache per-instrument).
      let registry = instrumentRegistries.get(instrumentKey);
      if (!registry) {
        // Query holdings utk instrument leg ini.
        const isAmulet = t.instrumentId.toLowerCase() === 'amulet';
        const holdings = isAmulet
          ? await this.queryAmuletHoldings(senderPartyId)
          : await this.getTokenHoldingCids(senderPartyId, t.instrumentId);
        if (holdings.length === 0) {
          return {
            ok: false,
            updateId: null,
            transferKind: 'unknown',
            error: `Sender has no ${t.instrumentId} holdings for leg to ${t.receiverPartyId.split('::')[0]}`,
          };
        }
        // Kirim SEMUA holdings ke registry resolve (prototype spec).
        // BatchTransfer akan threading change antar leg.
        const inputHoldingCids = holdings.map((h) => h.contractId);
        const protoTransferSpec = {
          sender: senderPartyId,
          receiver: t.receiverPartyId,
          amount: t.amount.toFixed(10),
          instrumentId: { admin: t.instrumentAdmin, id: t.instrumentId },
          lock: null,
          requestedAt: nowIso,
          executeBefore,
          inputHoldingCids,
          meta: {
            values: t.description
              ? { 'splice.lfdecentralizedtrust.org/reason': t.description }
              : {},
          },
        };
        const regRes = await this.callTransferFactoryRegistry(
          {
            expectedAdmin: t.instrumentAdmin,
            transfer: protoTransferSpec,
            extraArgs: { context: { values: {} }, meta: { values: {} } },
          },
          t.instrumentAdmin,
        );
        if (!regRes) {
          return {
            ok: false,
            updateId: null,
            transferKind: 'unknown',
            error: `Registry call failed for ${t.instrumentId} leg to ${t.receiverPartyId.split('::')[0]}`,
          };
        }
        registry = {
          factoryId: regRes.factoryId,
          choiceContextData: regRes.choiceContextData,
          disclosedContracts: regRes.disclosedContracts,
          transferKind: regRes.transferKind,
        };
        instrumentRegistries.set(instrumentKey, registry);
        lastTransferKind = registry.transferKind;
        // Dedupe disclosed contracts per instrument. Key yang benar adalah
        // `contractId` — dedupe lama membaca `.contract` (undefined) sehingga
        // SEMUA entry setelah yang pertama dianggap duplikat dan dibuang.
        // Jalur custodial tidak tersandung (service account melihat factory
        // langsung tanpa disclosure), tapi interactive prepare (party user)
        // butuh disclosure lengkap → CONTRACT_NOT_FOUND tanpa perbaikan ini.
        for (const dc of registry.disclosedContracts) {
          const dcRec = dc as Record<string, unknown>;
          const dcCid = dcRec.contractId ?? dcRec.contract;
          const exists = allDisclosedContracts.some((existing) => {
            const ex = existing as Record<string, unknown>;
            return (ex.contractId ?? ex.contract) === dcCid;
          });
          if (!exists) allDisclosedContracts.push(dc);
        }
      }
      // Build transferSpec utk leg ini (receiver + amount spesifik per leg).
      // HOLDINGS THREADING: hanya LEG PERTAMA per instrument yang membawa
      // inputHoldingCids (semua holdings). Leg berikutnya instrument sama
      // mengirim [] — DAML me-fetch change hasil leg sebelumnya. Kalau leg
      // berikutnya me-list holdings yang sama, leg pertama sudah
      // meng-archive-nya → CONTRACT_NOT_ACTIVE (sub-transaction fetch).
      const isFirstLegForInstrument = !instrumentRegistries.has(
        `${t.instrumentAdmin}|${t.instrumentId}`,
      );
      const isAmuletLeg = t.instrumentId.toLowerCase() === 'amulet';
      const legHoldings = isFirstLegForInstrument
        ? isAmuletLeg
          ? await this.queryAmuletHoldings(senderPartyId)
          : await this.getTokenHoldingCids(senderPartyId, t.instrumentId)
        : [];
      const transferSpec = {
        sender: senderPartyId,
        receiver: t.receiverPartyId,
        amount: t.amount.toFixed(10),
        instrumentId: { admin: t.instrumentAdmin, id: t.instrumentId },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: legHoldings.map((h) => h.contractId),
        meta: {
          values: t.description
            ? { 'splice.lfdecentralizedtrust.org/reason': t.description }
            : {},
        },
      };
      transferCalls.push({
        factoryCid: registry.factoryId,
        choiceArg: {
          expectedAdmin: t.instrumentAdmin,
          transfer: transferSpec,
          extraArgs: {
            context: registry.choiceContextData,
            meta: { values: {} },
          },
        },
      });
    }

    // optFeaturedAppRightCid: nullable (null bila FAR belum setup).
    const optFar = farCid ?? null;

    const choiceArgument = {
      transferCalls,
      optFeaturedAppRightCid: optFar,
    };

    const commandId = clientNonce
      ? `proxy-batch-multi-${createHash('sha256')
          .update(`${senderPartyId}|${clientNonce}`)
          .digest('hex')
          .slice(0, 32)}`
      : `proxy-batch-multi-${senderPartyId.slice(0, 12)}-${randomUUID().slice(0, 16)}`;

    this.logger.log(
      `WalletUserProxy_BatchTransfer (multi ${transferCalls.length} legs): ` +
        `sender=${senderPartyId.split('::')[0]} legs=[${transfers
          .map(
            (t) =>
              `${t.receiverPartyId.split('::')[0]}:${t.amount}:${t.instrumentId}`,
          )
          .join(', ')}] ` +
        `wup=${wupCid.slice(0, 16)}... far=${farCid ? 'attached' : 'None'}`,
    );

    // Disclosed contracts: WUP + FAR + registry contracts.
    const wupDisclosure =
      await this.proxyCache.getWalletUserProxyDisclosedContract();
    const farDisclosure =
      await this.proxyCache.getFeaturedAppRightDisclosedContract();
    const disclosedContracts: unknown[] = [
      ...allDisclosedContracts,
      ...(wupDisclosure ? [wupDisclosure] : []),
      ...(farDisclosure ? [farDisclosure] : []),
    ];

    const { ok, status, text } = await this.exerciseChoice(
      wupCid,
      this.proxyCache.wupTemplateId,
      'WalletUserProxy_BatchTransfer',
      choiceArgument,
      [senderPartyId], // controller = getFirstSender = sender party
      commandId,
      'submit-and-wait-for-transaction-tree',
      disclosedContracts,
    );

    if (ok) {
      const updateId = extractUpdateIdFromTree(text);
      let transferInstructionCid: string | null = null;
      if (lastTransferKind === 'offer') {
        transferInstructionCid = extractCreatedContractId(text);
      }
      this.logger.log(
        `Proxy batch transfer (multi) OK: kind=${lastTransferKind} ` +
          `updateId=${updateId?.slice(0, 16) ?? 'unknown'} legs=${transferCalls.length}`,
      );
      return {
        ok: true,
        updateId,
        transferKind: lastTransferKind,
        transferInstructionCid,
      };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(
      `WalletUserProxy_BatchTransfer (multi) failed ${status}: ${errMsg}`,
    );
    return {
      ok: false,
      updateId: null,
      transferKind: lastTransferKind,
      error: errMsg,
    };
  }

  /**
   * BUILD variant dari executeProxyBatchTransferMulti — untuk interactive
   * submission via signing relay (user external). Menyusun ExerciseCommand
   * WalletUserProxy_BatchTransfer multi-leg (transfer utama + platform fee)
   * TANPA men-submit; submitter = tanda tangan user di browser.
   *
   * Kenapa BatchTransfer (bukan AmuletRules_Transfer multi-output):
   *   - Choice controller = FIRST SENDER party → cukup SATU tanda tangan user
   *     (AmuletRules mewajibkan co-authorizer provider + semua receiver →
   *     terbukti DAML_AUTHORIZATION_ERROR pada interactive submission).
   *   - Holdings threading antar leg ditangani DAML (kirim semua input
   *     holdings per instrument; change di-thread).
   *   - Kind per instrument mengikuti preapproval receiver (direct/offer).
   *
   * Atomic: SEMUA leg (transfer + fee) settle dalam SATU transaksi atau
   * batal semua — fee platform dijamin terkumpul bersamaan dengan transfer.
   */
  async buildProxyBatchTransferCommand(params: {
    senderPartyId: string;
    transfers: Array<{
      receiverPartyId: string;
      amount: number;
      instrumentId: string; // 'Amulet' (CC) atau token id (USDCx)
      instrumentAdmin: string; // DSO utk CC, registrar utk non-CC
      description?: string;
    }>;
    clientNonce?: string;
  }): Promise<
    | {
        ok: true;
        command: Record<string, unknown>;
        commandId: string;
        disclosedContracts: unknown[];
        transferKind: string;
      }
    | { ok: false; error: string }
  > {
    if (!this.proxyCache) {
      return { ok: false, error: 'ProxyCacheService not injected' };
    }
    const wupCid = await this.proxyCache.getWalletUserProxyCid();
    if (!wupCid) {
      return { ok: false, error: 'WalletUserProxy contractId not found' };
    }
    const farCid = await this.proxyCache.getFeaturedAppRightCid();
    const { senderPartyId, transfers } = params;
    if (transfers.length === 0) {
      return { ok: false, error: 'No transfers provided' };
    }

    const now = new Date();
    const executeBefore = new Date(
      now.getTime() + 24 * 3600 * 1000,
    ).toISOString();
    const nowIso = now.toISOString();

    // FACTORY PER INSTRUMENT: factory utk instrument sama adalah contract
    // yang identik — dua exercise pada factory sama (choice non-consuming)
    // diperbolehkan dalam satu tx; factory BERBEDA utk instrument sama →
    // CONTRACT_NOT_FOUND. REGISTRY dipanggil PER LEG (bukan per instrument)
    // — lihat catatan besar di dalam loop.
    const factoryByInstrument = new Map<string, string>();
    const nonAmuletSeen = new Set<string>();
    const allDisclosedContracts: unknown[] = [];
    let lastTransferKind = 'direct';

    const transferCalls: Array<{
      factoryCid: string;
      choiceArg: Record<string, unknown>;
    }> = [];

    // ── POOL AMULET utk alokasi antar leg CC ────────────────────────────
    // Dua strategi, sesuai kemampuan WalletUserProxy yang ter-deploy
    // (MainNet 2026-08-29: splice-util-featured-app-proxies 1.2.4 —
    // package 88bcea6e…, commit batch-transfer #3018/#3216):
    //
    //   1. DISJOINT (utama): tiap leg CC bawa holdings sendiri yang tidak
    //      overlap (best-fit: single-fit dulu, merge hanya bila perlu).
    //   2. THREADING (fallback): WUP 1.2.4 men-thread senderChangeCids leg
    //      sebelumnya sebagai input tambahan leg berikutnya (senderChangeMap).
    //      Wallet single-holding (mayoritas user!) TIDAK MUNGKIN disjoint →
    //      leg CC pertama bawa best-fit holdings, leg CC berikutnya
    //      inputHoldingCids KOSONG (change leg-1 otomatis jadi input).
    //      Syarat kumulatif: total eff pool >= total amount semua leg CC.
    //
    // INDEX-LAG GUARD: queryAmuletHoldingsRaw membaca ACS pada offset
    // ledger-end — transaksi yang settle 1-3 detik lalu (mis. atomic send
    // beruntun) belum terlihat, pool tampak kurang → gagal alokasi padahal
    // dana cukup. Simulasi alokasi di bawah menolak fallback prematur:
    // bila gagal, tunggu 3s, re-fetch pool, coba sekali lagi.
    let amuletPool: Array<{ contractId: string; eff: number }> = [];
    let fullAmuletCids: string[] = [];
    /** 'disjoint' = per-leg holdings terpisah; 'threading' = leg-1 bawa semua, leg berikut kosong. */
    let amuletMode: 'disjoint' | 'threading' = 'disjoint';
    const hasAmuletLeg = transfers.some(
      (t) => t.instrumentId.toLowerCase() === 'amulet',
    );
    if (hasAmuletLeg) {
      const amuletLegs = transfers.filter(
        (t) => t.instrumentId.toLowerCase() === 'amulet',
      );
      const buildPool = async () => {
        const openRound = await this.fetchScanProxyContract(
          'open-and-issuing-mining-rounds',
        );
        const round = openRound?.round ?? 0;
        const raw = await this.queryAmuletHoldingsRaw(senderPartyId);
        return raw
          .map((h) => {
            const init = parseFloat(h.initialAmount) || 0;
            const rate = parseFloat(h.ratePerRound) || 0;
            const decay = Math.max(0, round - (h.createdAtRound || 0)) * rate;
            return { contractId: h.contractId, eff: Math.max(0, init - decay) };
          })
          .sort((a, b) => a.eff - b.eff); // ascending — set terkecil dulu
      };
      /** Simulasi best-fit disjoint utk semua leg CC — true bila pool cukup. */
      const canCoverDisjoint = (
        pool: Array<{ contractId: string; eff: number }>,
      ): boolean => {
        const sim = [...pool];
        for (const leg of amuletLegs) {
          const singleIdx = sim.findIndex((h) => h.eff >= leg.amount);
          if (singleIdx >= 0) {
            sim.splice(singleIdx, 1);
            continue;
          }
          let acc = 0;
          while (acc < leg.amount && sim.length > 0) {
            acc += sim.shift()!.eff;
          }
          if (acc < leg.amount) return false;
        }
        return true;
      };
      /** Cek kumulatif utk mode threading — total pool >= total kebutuhan. */
      const canCoverCumulative = (
        pool: Array<{ contractId: string; eff: number }>,
      ): boolean =>
        pool.reduce((s, h) => s + h.eff, 0) >=
        amuletLegs.reduce((s, l) => s + l.amount, 0) - 1e-9;
      try {
        amuletPool = await buildPool();
        if (!canCoverDisjoint(amuletPool)) {
          // Retry sekali setelah 3s — beri waktu ACS index mengejar.
          await new Promise((r) => setTimeout(r, 3_000));
          amuletPool = await buildPool();
        }
        if (canCoverDisjoint(amuletPool)) {
          // jalur utama — terbukti MainNet
        } else if (canCoverCumulative(amuletPool)) {
          // Wallet single-/few-holding → WUP 1.2.4 threading change antar leg.
          amuletMode = 'threading';
          this.logger.log(
            `Amulet allocation: DISJOINT tidak feasible (pool ${amuletPool.length} holding) → mode THREADING (WUP 1.2.4 senderChangeMap)`,
          );
        } else {
          return {
            ok: false,
            error:
              'Insufficient holdings to cover legs (re-checked after index catch-up) — falling back',
          };
        }
        fullAmuletCids = amuletPool.map((h) => h.contractId);
      } catch {
        /* pool kosong → alokasi leg CC akan gagal → fallback legacy */
      }
    }

    // NOTE: batch guard dihapus — registry returnKind tidak akurat untuk
    // menentukan direct vs offer (semua CC return "direct"). Biarkan ledger
    // yang memvalidasi: [offer+direct] lolos, [direct+direct] ditolak DAML
    // → signing-relay fallback ke legacy secara graceful.

    let amuletLegsAssigned = 0; // utk mode threading: hanya leg CC pertama bawa input

    for (const t of transfers) {
      const instrumentKey = `${t.instrumentAdmin}|${t.instrumentId}`;
      // ── REGISTRY PER LEG (FIX ForOwner mismatch, MainNet 2026-08-29) ──
      // choiceContextData dari registry berisi preapproval cid SPESIFIK
      // RECEIVER (transferPreapprovalContextKey). DAML 0.7.0
      // (ExternalPartyAmuletRules:357-359) mem-fetchChecked preapproval itu
      // dengan grup ForOwner{owner=transfer.receiver} — memakai context leg
      // lain (mis. preapproval MEXC utk leg fee ke canquest-fee) menghasilkan
      // "Contract group identifier mismatch: expected ForOwner{owner=fee},
      // got ForOwner{owner=mexc}". Context HARUS dibangun per receiver.
      const isAmuletProto = t.instrumentId.toLowerCase() === 'amulet';
      if (!isAmuletProto) {
        if (nonAmuletSeen.has(t.instrumentId)) {
          return {
            ok: false,
            error: `Multiple ${t.instrumentId} legs not supported (holdings overlap)`,
          };
        }
        nonAmuletSeen.add(t.instrumentId);
      }
      const protoHoldingCids = isAmuletProto
        ? fullAmuletCids
        : (
            await this.getTokenHoldingCids(senderPartyId, t.instrumentId)
          ).map((h) => h.contractId);
      if (protoHoldingCids.length === 0) {
        return {
          ok: false,
          error: `Sender has no ${t.instrumentId} holdings for leg to ${t.receiverPartyId.split('::')[0]}`,
        };
      }
      const protoTransferSpec = {
        sender: senderPartyId,
        receiver: t.receiverPartyId,
        amount: t.amount.toFixed(10),
        instrumentId: { admin: t.instrumentAdmin, id: t.instrumentId },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: protoHoldingCids,
        meta: {
          values: t.description
            ? { 'splice.lfdecentralizedtrust.org/reason': t.description }
            : {},
        },
      };
      const regRes = await this.callTransferFactoryRegistry(
        {
          expectedAdmin: t.instrumentAdmin,
          transfer: protoTransferSpec,
          extraArgs: { context: { values: {} }, meta: { values: {} } },
        },
        t.instrumentAdmin,
      );
      if (!regRes) {
        return {
          ok: false,
          error: `Registry call failed for ${t.instrumentId} leg to ${t.receiverPartyId.split('::')[0]}`,
        };
      }
      const knownFactory = factoryByInstrument.get(instrumentKey);
      if (knownFactory && knownFactory !== regRes.factoryId) {
        return {
          ok: false,
          error: `Factory mismatch for ${t.instrumentId} legs — cannot exercise two factories for one instrument`,
        };
      }
      factoryByInstrument.set(instrumentKey, regRes.factoryId);
      const registry = {
        factoryId: regRes.factoryId,
        choiceContextData: regRes.choiceContextData,
        disclosedContracts: regRes.disclosedContracts,
        transferKind: regRes.transferKind,
      };
      lastTransferKind = registry.transferKind;
      // Dedupe by contractId (key `contractId`, bukan `contract`) —
      // lihat catatan fix yang sama di executeProxyBatchTransferMulti.
      for (const dc of registry.disclosedContracts) {
        const dcRec = dc as Record<string, unknown>;
        const dcCid = dcRec.contractId ?? dcRec.contract;
        const exists = allDisclosedContracts.some((existing) => {
          const ex = existing as Record<string, unknown>;
          return (ex.contractId ?? ex.contract) === dcCid;
        });
        if (!exists) allDisclosedContracts.push(dc);
      }
      // ALOKASI HOLDINGS per leg — lihat komentar POOL AMULET di atas.
      const isAmuletLeg = t.instrumentId.toLowerCase() === 'amulet';
      let legInputCids: string[];
      if (isAmuletLeg && amuletMode === 'threading' && amuletLegsAssigned > 0) {
        // MODE THREADING, leg CC ke-2+: inputHoldingCids KOSONG — WUP 1.2.4
        // otomatis menambahkan senderChangeCids leg sebelumnya (senderChangeMap)
        // sebagai input leg ini saat interpretasi.
        legInputCids = [];
        amuletLegsAssigned++;
      } else if (isAmuletLeg) {
        // BEST-FIT: prioritaskan SATU holding terkecil yang eff >= amount
        // (pool ascending). Gabung beberapa hanya bila tidak ada single-fit —
        // decay membuat holding nominal-exact bisa eff-nya sedikit di bawah
        // amount, dan ascending murni akan menghabiskan seluruh pool untuk
        // leg pertama sehingga leg berikutnya kehabisan.
        legInputCids = [];
        const singleIdx = amuletPool.findIndex((h) => h.eff >= t.amount);
        if (singleIdx >= 0) {
          legInputCids.push(amuletPool.splice(singleIdx, 1)[0].contractId);
        } else {
          let acc = 0;
          while (acc < t.amount && amuletPool.length > 0) {
            const h = amuletPool.shift()!;
            legInputCids.push(h.contractId);
            acc += h.eff;
          }
          if (acc < t.amount) {
            return {
              ok: false,
              error: `Insufficient holdings to cover leg (${acc.toFixed(4)} < ${t.amount} ${t.instrumentId}) — falling back`,
            };
          }
        }
        amuletLegsAssigned++;
      } else {
        // Non-Amulet: satu leg per instrument (guard duplikat ada di atas,
        // sebelum registry call).
        const th = await this.getTokenHoldingCids(senderPartyId, t.instrumentId);
        if (th.length === 0) {
          return {
            ok: false,
            error: `Sender has no ${t.instrumentId} holdings for leg to ${t.receiverPartyId.split('::')[0]}`,
          };
        }
        legInputCids = th.map((h) => h.contractId);
      }
      const transferSpec = {
        sender: senderPartyId,
        receiver: t.receiverPartyId,
        amount: t.amount.toFixed(10),
        instrumentId: { admin: t.instrumentAdmin, id: t.instrumentId },
        lock: null,
        requestedAt: nowIso,
        executeBefore,
        inputHoldingCids: legInputCids,
        meta: {
          values: t.description
            ? { 'splice.lfdecentralizedtrust.org/reason': t.description }
            : {},
        },
      };
      transferCalls.push({
        factoryCid: registry.factoryId,
        choiceArg: {
          expectedAdmin: t.instrumentAdmin,
          transfer: transferSpec,
          extraArgs: {
            context: registry.choiceContextData,
            meta: { values: {} },
          },
        },
      });
    }

    const optFar = farCid ?? null;
    const choiceArgument = {
      transferCalls,
      optFeaturedAppRightCid: optFar,
    };

    const commandId = params.clientNonce
      ? `proxy-batch-multi-${createHash('sha256')
          .update(`${senderPartyId}|${params.clientNonce}`)
          .digest('hex')
          .slice(0, 32)}`
      : `proxy-batch-multi-${senderPartyId.slice(0, 12)}-${randomUUID().slice(0, 16)}`;

    const wupDisclosure =
      await this.proxyCache.getWalletUserProxyDisclosedContract();
    const farDisclosure =
      await this.proxyCache.getFeaturedAppRightDisclosedContract();
    if (!wupDisclosure) {
      return {
        ok: false,
        error: 'WalletUserProxy disclosed contract unavailable (no blob)',
      };
    }
    const disclosedContracts: unknown[] = [
      ...allDisclosedContracts,
      wupDisclosure,
      ...(farDisclosure ? [farDisclosure] : []),
    ];

    this.logger.log(
      `BUILD WalletUserProxy_BatchTransfer (interactive, ${transferCalls.length} legs): ` +
        `sender=${senderPartyId.split('::')[0]} legs=[${transfers
          .map(
            (t) =>
              `${t.receiverPartyId.split('::')[0]}:${t.amount}:${t.instrumentId}`,
          )
          .join(', ')}] kind=${lastTransferKind}`,
    );

    return {
      ok: true,
      command: {
        ExerciseCommand: {
          templateId: this.proxyCache.wupTemplateId,
          contractId: wupCid,
          choice: 'WalletUserProxy_BatchTransfer',
          choiceArgument,
        },
      },
      commandId,
      disclosedContracts,
      transferKind: lastTransferKind,
    };
  }

  /**
   * BUILD multi-command alur "canton-loop": SATU ExerciseCommand
   * TransferFactory_Transfer PER LEG (transfer utama + platform fee) untuk
   * interactive submission via signing relay.
   *
   * Bukti MainNet (ccview update 122039728fded9…): dapp lain menyelesaikan
   * [send 418.43 CC → CEX] + [fee 16.18 CC → party validator] sebagai DUA
   * exercise TransferFactory_Transfer dalam SATU update (2 ROOT event).
   *
   * Kenapa per-command (bukan WalletUserProxy_BatchTransfer):
   *   - WUP BatchTransfer menabrak owner-group constraint AmuletRules saat
   *     salah satu receiver adalah party EXTERNAL (CEX / user validator lain)
   *     — DAML menolak campuran kelompok ForOwner beda dalam SATU exercise.
   *   - Dua exercise TERPISAH = dua konteks interpretasi mandiri → tiap
   *     exercise hanya punya owner tunggal (sender). Choice
   *     TransferFactory_Transfer non-consuming → factory contract boleh
   *     di-exercise 2x dalam satu transaksi (persis pola canton-loop).
   *
   * Catatan transport: dokumen JSON API menyebut interactive submission
   * "single command", tapi jalur kita adalah participant Ledger API via
   * wallet-sdk (`commands` array, tanpa validasi client-side). Caller wajib
   * menyediakan fallback (WUP batch / legacy single) bila participant menolak.
   *
   * Holdings per leg WAJIB disjoint (satu holding tidak boleh jadi input dua
   * exercise dalam satu tx — exercise pertama meng-archive-nya). Alokasi
   * best-fit + index-lag retry, sama dengan buildProxyBatchTransferCommand.
   */
  async buildFactoryTransferCommands(params: {
    senderPartyId: string;
    transfers: Array<{
      receiverPartyId: string;
      amount: number;
      instrumentId: string; // 'Amulet' (CC) atau token id (USDCx)
      instrumentAdmin: string; // DSO utk CC, registrar utk non-CC
      description?: string;
    }>;
    clientNonce?: string;
  }): Promise<
    | {
        ok: true;
        commands: Record<string, unknown>[];
        commandId: string;
        disclosedContracts: unknown[];
        transferKind: string;
      }
    | { ok: false; error: string }
  > {
    const { senderPartyId, transfers } = params;
    if (transfers.length === 0) {
      return { ok: false, error: 'No transfers provided' };
    }

    const now = new Date();
    const executeBefore = new Date(
      now.getTime() + 24 * 3600 * 1000,
    ).toISOString();
    const nowIso = now.toISOString();

    // Pool Amulet + alokasi disjoint antar leg CC (mirror
    // buildProxyBatchTransferCommand, termasuk index-lag retry 3s).
    let amuletPool: Array<{ contractId: string; eff: number }> = [];
    const amuletLegs = transfers.filter(
      (t) => t.instrumentId.toLowerCase() === 'amulet',
    );
    if (amuletLegs.length > 0) {
      const buildPool = async () => {
        const openRound = await this.fetchScanProxyContract(
          'open-and-issuing-mining-rounds',
        );
        const round = openRound?.round ?? 0;
        const raw = await this.queryAmuletHoldingsRaw(senderPartyId);
        return raw
          .map((h) => {
            const init = parseFloat(h.initialAmount) || 0;
            const rate = parseFloat(h.ratePerRound) || 0;
            const decay = Math.max(0, round - (h.createdAtRound || 0)) * rate;
            return { contractId: h.contractId, eff: Math.max(0, init - decay) };
          })
          .sort((a, b) => a.eff - b.eff); // ascending — set terkecil dulu
      };
      const canCoverDisjoint = (
        pool: Array<{ contractId: string; eff: number }>,
      ): boolean => {
        const sim = [...pool];
        for (const leg of amuletLegs) {
          const singleIdx = sim.findIndex((h) => h.eff >= leg.amount);
          if (singleIdx >= 0) {
            sim.splice(singleIdx, 1);
            continue;
          }
          let acc = 0;
          while (acc < leg.amount && sim.length > 0) acc += sim.shift()!.eff;
          if (acc < leg.amount) return false;
        }
        return true;
      };
      try {
        amuletPool = await buildPool();
        if (!canCoverDisjoint(amuletPool)) {
          await new Promise((r) => setTimeout(r, 3_000));
          amuletPool = await buildPool();
          if (!canCoverDisjoint(amuletPool)) {
            return {
              ok: false,
              error:
                'Insufficient holdings to cover legs disjointly (re-checked after index catch-up) — falling back',
            };
          }
        }
      } catch {
        /* pool kosong → alokasi leg CC gagal → fallback caller */
      }
    }

    const factoryInterfaceId =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory';

    const commands: Record<string, unknown>[] = [];
    const allDisclosedContracts: unknown[] = [];
    const nonAmuletSeen = new Set<string>();
    let lastTransferKind = 'direct';
    // Factory per instrument HARUS identik antar leg instrument sama — dua
    // exercise pada factory BERBEDA utk instrument sama → CONTRACT_NOT_FOUND.
    const factoryByInstrument = new Map<string, string>();

    for (const t of transfers) {
      const isAmuletLeg = t.instrumentId.toLowerCase() === 'amulet';

      // ── Alokasi holdings leg ini ────────────────────────────────────────
      let legInputCids: string[];
      if (isAmuletLeg) {
        legInputCids = [];
        const singleIdx = amuletPool.findIndex((h) => h.eff >= t.amount);
        if (singleIdx >= 0) {
          legInputCids.push(amuletPool.splice(singleIdx, 1)[0].contractId);
        } else {
          let acc = 0;
          while (acc < t.amount && amuletPool.length > 0) {
            const h = amuletPool.shift()!;
            legInputCids.push(h.contractId);
            acc += h.eff;
          }
          if (acc < t.amount) {
            return {
              ok: false,
              error: `Insufficient holdings to cover leg disjointly (${acc.toFixed(4)} < ${t.amount} ${t.instrumentId}) — falling back`,
            };
          }
        }
      } else {
        // Non-Amulet: satu leg per instrument (holdings overlap antar leg
        // instrument sama tidak didukung tanpa disjoint pool).
        if (nonAmuletSeen.has(t.instrumentId)) {
          return {
            ok: false,
            error: `Multiple ${t.instrumentId} legs not supported (holdings overlap)`,
          };
        }
        nonAmuletSeen.add(t.instrumentId);
        const th = await this.getTokenHoldingCids(senderPartyId, t.instrumentId);
        if (th.length === 0) {
          return {
            ok: false,
            error: `Sender has no ${t.instrumentId} holdings for leg to ${t.receiverPartyId.split('::')[0]}`,
          };
        }
        legInputCids = th.map((h) => h.contractId);
      }

      // ── Registry PER LEG (bukan per instrument) ─────────────────────────
      // choiceContext bisa spesifik receiver (rule direct vs offer beda
      // preapproval) → context leg external ≠ context leg fee internal.
      const choiceArgument: Record<string, unknown> = {
        expectedAdmin: t.instrumentAdmin,
        transfer: {
          sender: senderPartyId,
          receiver: t.receiverPartyId,
          amount: t.amount.toFixed(10),
          instrumentId: { admin: t.instrumentAdmin, id: t.instrumentId },
          lock: null,
          requestedAt: nowIso,
          executeBefore,
          inputHoldingCids: legInputCids,
          meta: {
            values: t.description
              ? { 'splice.lfdecentralizedtrust.org/reason': t.description }
              : {},
          },
        },
        extraArgs: { context: { values: {} }, meta: { values: {} } },
      };
      const registry = await this.callTransferFactoryRegistry(
        choiceArgument,
        t.instrumentAdmin,
      );
      if (!registry) {
        return {
          ok: false,
          error: `Registry call failed for ${t.instrumentId} leg to ${t.receiverPartyId.split('::')[0]}`,
        };
      }
      (choiceArgument.extraArgs as Record<string, unknown>).context =
        registry.choiceContextData;
      lastTransferKind = registry.transferKind;

      const knownFactory = factoryByInstrument.get(t.instrumentId);
      if (knownFactory && knownFactory !== registry.factoryId) {
        return {
          ok: false,
          error: `Factory mismatch for ${t.instrumentId} legs — cannot exercise two factories for one instrument`,
        };
      }
      factoryByInstrument.set(t.instrumentId, registry.factoryId);

      // Dedupe disclosure by contractId (`contractId`, bukan `contract`).
      for (const dc of registry.disclosedContracts) {
        const dcCid =
          (dc as Record<string, unknown>).contractId ??
          (dc as Record<string, unknown>).contract;
        const exists = allDisclosedContracts.some((existing) => {
          const ex = existing as Record<string, unknown>;
          return (ex.contractId ?? ex.contract) === dcCid;
        });
        if (!exists) allDisclosedContracts.push(dc);
      }

      commands.push({
        ExerciseCommand: {
          templateId: factoryInterfaceId,
          contractId: registry.factoryId,
          choice: 'TransferFactory_Transfer',
          choiceArgument,
        },
      });
    }

    const commandId = params.clientNonce
      ? `multi-tf-${createHash('sha256')
          .update(`${senderPartyId}|${params.clientNonce}`)
          .digest('hex')
          .slice(0, 32)}`
      : `multi-tf-${senderPartyId.slice(0, 12)}-${randomUUID().slice(0, 16)}`;

    this.logger.log(
      `BUILD multi TransferFactory_Transfer (interactive, ${commands.length} cmds): ` +
        `sender=${senderPartyId.split('::')[0]} legs=[${transfers
          .map(
            (t) =>
              `${t.receiverPartyId.split('::')[0]}:${t.amount}:${t.instrumentId}`,
          )
          .join(', ')}] kind=${lastTransferKind}`,
    );

    return {
      ok: true,
      commands,
      commandId,
      disclosedContracts: allDisclosedContracts,
      transferKind: lastTransferKind,
    };
  }

  /**
   * Execute offer choice (Accept / Reject / Withdraw) via WalletUserProxy.
   *
   * DAML reference: choice controller = `user` party (proxyArg.user). Signatory
   * of WalletUserProxy = provider (app-canquest). Membungkus:
   *   WalletUserProxy_TransferInstruction_Accept
   *   WalletUserProxy_TransferInstruction_Reject
   *   WalletUserProxy_TransferInstruction_Withdraw
   *
   * DAMAL internal tetap exercise underlying TransferInstruction choice → event
   * stream WSS fire event sama → OfferReconciler / balance handler tetap realtime.
   *
   * Accept butuh choiceContext dari registry (TransferRule disclosed contract).
   * Reject/Withdraw biasanya choiceArg kosong {}.
   *
   * BLOCKER: featuredAppRightCid WAJIB (bukan optional) di proxy choice ini,
   * sama dgn FASE 4. Flag USE_WALLET_PROXY=true akan DAMAL reject kalau FAR
   * belum approve Canton Foundation.
   *
   * @see docs/WALLET_USER_PROXY_SETUP.md
   */
  async executeProxyOfferChoice(params: {
    userPartyId: string;
    transferInstructionCid: string;
    action: 'accept' | 'reject' | 'withdraw';
    /** instrumentAdmin (utk registry choice-context lookup). Kosong = CC path. */
    instrumentAdmin?: string;
  }): Promise<{ ok: boolean; updateId: string | null; error?: string }> {
    if (!this.proxyCache) {
      return {
        ok: false,
        updateId: null,
        error: 'ProxyCacheService not injected — proxy offer unavailable',
      };
    }
    const wupCid = await this.proxyCache.getWalletUserProxyCid();
    if (!wupCid) {
      return {
        ok: false,
        updateId: null,
        error:
          'WalletUserProxy contractId not found (set CANTON_PROXY_WUP_CID)',
      };
    }
    const farCid = await this.proxyCache.getFeaturedAppRightCid();
    if (!farCid) {
      return {
        ok: false,
        updateId: null,
        error:
          'FeaturedAppRight contractId not found — proxy offer choice WAJIB ' +
          'FAR valid (approve Canton Foundation). Set CANTON_PROXY_FAR_CID kalau sudah ada.',
      };
    }

    const { userPartyId, transferInstructionCid, action, instrumentAdmin } =
      params;

    // choiceContext untuk Accept (registry call). Reject/Withdraw biasanya kosong.
    // disclosedContracts juga didapat dari sini (TransferRule contract).
    let choiceContextData: Record<string, unknown> = { values: {} };
    let disclosedContracts: unknown[] = [];
    if (action === 'accept') {
      const ctx = await this.getInstructionChoiceContext(
        transferInstructionCid,
        'accept',
        instrumentAdmin ?? '',
      );
      if (!ctx) {
        return {
          ok: false,
          updateId: null,
          error:
            'Failed to fetch choice context from registry (404/error). Accept ' +
            'requires TransferRule disclosed contract.',
        };
      }
      choiceContextData = ctx.choiceContextData;
      disclosedContracts = ctx.disclosedContracts;
    }

    // choiceName = WalletUserProxy_TransferInstruction_<Action> (kapital).
    const choiceName = `WalletUserProxy_TransferInstruction_${
      action.charAt(0).toUpperCase() + action.slice(1)
    }`;

    // choiceArg = arg underlying choice (sama dgn path lama).
    // Accept: { extraArgs: { context, meta } }. Reject/Withdraw: {}.
    const choiceArg =
      action === 'accept'
        ? { extraArgs: { context: choiceContextData, meta: { values: {} } } }
        : {};

    const proxyArg = {
      user: userPartyId,
      choiceArg,
      featuredAppRightCid: farCid,
    };

    const commandId = `proxy-${action}-${transferInstructionCid.slice(0, 16)}-${randomUUID().slice(0, 8)}`;

    this.logger.log(
      `WalletUserProxy_TransferInstruction_${action}: user=${userPartyId.split('::')[0]} ` +
        `cid=${transferInstructionCid.slice(0, 16)}... wup=${wupCid.slice(0, 16)}...`,
    );

    // Disclosed contracts: registry contracts (utk accept) + WUP + FAR.
    // WUP wajib disclose supaya user party bisa exercise choice.
    const wupDisclosure =
      await this.proxyCache.getWalletUserProxyDisclosedContract();
    const farDisclosure =
      await this.proxyCache.getFeaturedAppRightDisclosedContract();
    const allDisclosed: unknown[] = [
      ...disclosedContracts,
      ...(wupDisclosure ? [wupDisclosure] : []),
      ...(farDisclosure ? [farDisclosure] : []),
    ];

    const { ok, status, text } = await this.exerciseChoice(
      wupCid,
      this.proxyCache.wupTemplateId,
      choiceName,
      { cid: transferInstructionCid, proxyArg },
      [userPartyId], // controller = user party
      commandId,
      'submit-and-wait-for-transaction-tree',
      allDisclosed,
    );

    if (ok) {
      const updateId = extractUpdateIdFromTree(text);
      this.logger.log(
        `Proxy ${action} OK: updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
      );
      return { ok: true, updateId };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(`Proxy ${action} failed ${status}: ${errMsg}`);
    return { ok: false, updateId: null, error: errMsg };
  }

  /**
   * Kirim reward CC via CIP-0056 TransferFactory.
   * - Receiver punya TransferPreapproval → 'direct' (langsung mendarat).
   * - Tidak punya → 'offer': AmuletTransferInstruction dibiarkan PENDING di inbox wallet.
   *   TIDAK auto-accept — user terima manual via POST /party/offers/accept.
   * senderPartyId default = CANTON_REWARD_PARTY_ID (canquest-reward-user).
   */
  async sendReward(params: {
    senderPartyId?: string;
    receiverPartyId: string;
    amountCc: number;
    description: string;
    /**
     * Token instrument (opsional). Default = CC/Amulet (behavior lama).
     * Set keduanya untuk reward non-CC (mis. USDCx): resolve via TokenInstrumentHelper.
     * `amountCc` = jumlah token (bukan micro) — nama field dipertahankan utk backward-compat.
     */
    instrumentId?: string;
    instrumentAdmin?: string;
  }): Promise<{
    ok: boolean;
    kind?: 'direct' | 'offer';
    pending: boolean;
    rewardTxId?: string;
    transferInstructionCid?: string;
    error?: string;
  }> {
    const senderPartyId =
      params.senderPartyId ?? this.config.get<string>('CANTON_REWARD_PARTY_ID');
    if (!senderPartyId) {
      return {
        ok: false,
        pending: false,
        error: 'CANTON_REWARD_PARTY_ID not configured',
      };
    }
    const res = await this.executeTransferFactoryTransfer({
      senderPartyId,
      receiverPartyId: params.receiverPartyId,
      amountCc: params.amountCc,
      description: params.description,
      instrumentId: params.instrumentId,
      instrumentAdmin: params.instrumentAdmin,
    });
    if (!res.ok) {
      return {
        ok: false,
        pending: false,
        error: res.error ?? 'reward transfer failed',
      };
    }
    if (res.transferKind === 'direct') {
      return {
        ok: true,
        kind: 'direct',
        pending: false,
        rewardTxId: res.updateId ?? undefined,
      };
    }
    if (res.transferKind === 'offer' && res.transferInstructionCid) {
      // One-Step OFF: biarkan pending, JANGAN accept atas nama user.
      // rewardTxId = Canton update_id (format "1220…") supaya link explorer jalan.
      // transferInstructionCid disimpan terpisah (contract_id, BUKAN untuk explorer).
      return {
        ok: true,
        kind: 'offer',
        pending: true,
        rewardTxId: res.updateId ?? undefined,
        transferInstructionCid: res.transferInstructionCid,
      };
    }
    return {
      ok: false,
      pending: false,
      error: 'reward transfer failed (unknown kind)',
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // READ / CANCEL TransferPreapproval via Ledger ACS (Keycloak admin token).
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * ACS lookup: TransferPreapproval TOKEN REGISTRY (USDCx dkk.) milik user.
   *
   * Berbeda dari TransferPreapproval CC (splice-wallet, via proposal +
   * provider accept) — versi registry: template
   * Utility.Registry.App.V0.Model.TransferPreapproval, SIGNATORY = receiver,
   * fields {operator, receiver, instrumentAdmin, instrumentAllowances}
   * (allowances kosong = SEMUA instrument registrar tsb). Cancel = choice
   * Archive (controller receiver). Create/cancel cukup SATU signature user
   * via interactive submission → cocok signing relay.
   */
  async findRegistryPreapproval(
    userPartyId: string,
  ): Promise<{
    contractId: string;
    templateId: string;
    instrumentAdmin: string;
    operator: string;
  } | null> {
    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      return null;
    }
    let contracts: unknown[] = [];
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({
          eventFormat: {
            filtersByParty: {
              [userPartyId]: {
                cumulative: [
                  {
                    identifierFilter: {
                      WildcardFilter: { value: { includeCreatedEventBlob: false } },
                    },
                  },
                ],
              },
            },
            verbose: true,
          },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) contracts = (await res.json()) as unknown[];
    } catch {
      return null;
    }
    for (const entry of contracts) {
      if (!entry || typeof entry !== 'object') continue;
      const wrapper = entry as Record<string, unknown>;
      const jsActive = (wrapper.contractEntry as Record<string, unknown>)
        ?.JsActiveContract as Record<string, unknown> | undefined;
      const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;
      const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
      if (
        !tplId.includes(
          'Utility.Registry.App.V0.Model.TransferPreapproval:TransferPreapproval',
        )
      ) {
        continue;
      }
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};
      const receiver = typeof args.receiver === 'string' ? args.receiver : '';
      if (!cantonPartyIdsEqual(receiver, userPartyId)) continue;
      const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
      if (!cid) continue;
      return {
        contractId: cid,
        templateId: tplId,
        instrumentAdmin:
          typeof args.instrumentAdmin === 'string' ? args.instrumentAdmin : '',
        operator: typeof args.operator === 'string' ? args.operator : '',
      };
    }
    return null;
  }

  /**
   * ACS lookup: TransferPreapproval contract whose receiver === partyId.
   *
   * @param partyId - The receiver party whose preapproval we want to find.
   * @param visibilityParty - Party whose contract store we query (ACS visibility).
   *   Defaults to `partyId` (the receiver). The validator/provider party may see
   *   contracts the receiver does not (e.g. if the operator lacks CanReadAs on
   *   the receiver), so callers can pass the provider party here.
   */
  async findTransferPreapprovalContract(
    partyId: string,
    visibilityParty?: string,
  ): Promise<{
    contractId: string;
    templateId: string;
    expiresAt?: string;
    provider?: string;
  } | null> {
    const targetReceiver = normalizeCantonPartyId(partyId) ?? partyId.trim();
    const queryParty = visibilityParty ?? partyId;

    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }

    let rows: unknown[] = [];
    let httpStatus = 200;
    let httpErr = '';
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({
          eventFormat: {
            filtersByParty: {
              [queryParty]: {
                cumulative: [
                  {
                    identifierFilter: {
                      WildcardFilter: {
                        value: { includeCreatedEventBlob: false },
                      },
                    },
                  },
                ],
              },
            },
            verbose: true,
          },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      httpStatus = res.status;
      if (!res.ok) {
        httpErr = (await res.text()).slice(0, 200);
        this.logger.warn(
          `findTransferPreapproval(queryParty=${queryParty.split('::')[0]}) ` +
            `HTTP ${res.status}: ${httpErr}`,
        );
        return null;
      }
      rows = (await res.json()) as unknown[];
      if (!Array.isArray(rows)) rows = [];
    } catch (err) {
      this.logger.warn(`findTransferPreapproval error: ${String(err)}`);
      return null;
    }

    // Diagnostic counters — log what the ACS returned so false-negatives are
    // traceable (rights gap vs visibility vs normalization).
    let transferPreapprovalRows = 0;
    let matched = false;

    for (const entry of rows) {
      if (!entry || typeof entry !== 'object') continue;
      const wrapper = entry as Record<string, unknown>;
      const active = wrapper.contractEntry as
        | Record<string, unknown>
        | undefined;
      const jsActive = active?.JsActiveContract as
        | Record<string, unknown>
        | undefined;
      const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;
      const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
      if (!tplId.includes('TransferPreapproval')) continue;
      transferPreapprovalRows++;
      const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};
      const receiver = typeof args.receiver === 'string' ? args.receiver : '';
      // Normalize both sides before comparing — the on-chain receiver may be
      // stored in a different case form than the incoming partyId.
      if (cantonPartyIdsEqual(receiver, targetReceiver) && cid) {
        matched = true;
        return {
          contractId: cid,
          templateId: tplId,
          expiresAt:
            typeof args.expiresAt === 'string' ? args.expiresAt : undefined,
          provider:
            typeof args.provider === 'string' ? args.provider : undefined,
        };
      }
    }

    this.logger.debug(
      `findTransferPreapproval(queryParty=${queryParty.split('::')[0]}, ` +
        `receiver=${targetReceiver.split('::')[0]}): rows=${rows.length} ` +
        `tpRows=${transferPreapprovalRows} matched=${matched} http=${httpStatus}`,
    );
    return null;
  }

  /**
   * Authoritative TransferPreapproval read — source of truth for the app.
   *
   * Queries up to THREE independent sources and returns active=true if ANY
   * reports an active preapproval. For money flow, a false-negative (thinking
   * a preapproval is gone when it isn't) is far more dangerous than a
   * false-positive, so we union the sources.
   *
   *   1. Ledger ACS under the RECEIVER party (operator reads as receiver).
   *   2. Ledger ACS under the PROVIDER party (validator sees contracts the
   *      receiver's contract store may not expose). Filtered by receiver.
   *   3. Splice admin REST (passed in by the caller) as a tertiary check.
   *
   * Also returns the raw per-source diagnostics so the debug endpoint can show
   * exactly which source saw what (useful when tracking down rights/visibility
   * mismatches).
   */
  async getTransferPreapprovalAuthoritative(
    partyId: string,
    spliceFallback?: { active: boolean; expiresAt?: string; provider?: string },
  ): Promise<{
    active: boolean;
    contractId?: string;
    templateId?: string;
    expiresAt?: string;
    provider?: string;
    source?: string;
    sources: {
      ledgerReceiver: boolean;
      ledgerProvider: boolean;
      splice: boolean | null;
    };
  }> {
    const providerParty =
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() || undefined;

    const [receiverHit, providerHit] = await Promise.all([
      this.findTransferPreapprovalContract(partyId).catch(() => null),
      providerParty
        ? this.findTransferPreapprovalContract(partyId, providerParty).catch(
            () => null,
          )
        : Promise.resolve(null),
    ]);

    const spliceActive =
      spliceFallback === undefined ? null : spliceFallback.active;

    const hit = receiverHit ?? providerHit;
    const spliceActiveOverride =
      spliceFallback?.active &&
      // Only trust splice as the deciding hit when neither ledger source saw it.
      !hit
        ? spliceFallback
        : undefined;

    if (hit) {
      const source = receiverHit ? 'ledger:receiver' : 'ledger:provider';
      return {
        active: true,
        contractId: hit.contractId,
        templateId: hit.templateId,
        expiresAt: hit.expiresAt,
        provider: hit.provider,
        source,
        sources: {
          ledgerReceiver: receiverHit !== null,
          ledgerProvider: providerHit !== null,
          splice: spliceActive,
        },
      };
    }

    if (spliceActiveOverride) {
      return {
        active: true,
        expiresAt: spliceActiveOverride.expiresAt,
        provider: spliceActiveOverride.provider,
        source: 'splice:rest',
        sources: {
          ledgerReceiver: false,
          ledgerProvider: false,
          splice: true,
        },
      };
    }

    return {
      active: false,
      sources: {
        ledgerReceiver: false,
        ledgerProvider: false,
        splice: spliceActive,
      },
    };
  }

  async cancelTransferPreapprovalViaLedger(
    partyId: string,
  ): Promise<{ ok: boolean; updateId?: string; error?: string }> {
    // Find the contract authoritatively (receiver view, then provider view).
    const receiverHit = await this.findTransferPreapprovalContract(partyId);
    const c =
      receiverHit ??
      (await (async () => {
        const providerParty = this.config
          .get<string>('CANTON_VALIDATOR_PARTY_ID')
          ?.trim();
        if (!providerParty) return null;
        return this.findTransferPreapprovalContract(partyId, providerParty);
      })());

    if (!c) return { ok: true }; // nothing to cancel

    // Try to exercise the cancel as the receiver first. If the operator lacks
    // CanActAs on the receiver, fall back to acting as the provider — the DAML
    // controller of TransferPreapproval_Cancel may be either signatory.
    const actAsCandidates = [partyId];
    const providerParty = this.config
      .get<string>('CANTON_VALIDATOR_PARTY_ID')
      ?.trim();
    if (providerParty && !cantonPartyIdsEqual(providerParty, partyId)) {
      actAsCandidates.push(providerParty);
    }

    this.logger.log(
      `Cancelling TransferPreapproval via Ledger: cid=${c.contractId.slice(0, 20)}…`,
    );

    let lastErr = 'unknown';
    for (const actAs of actAsCandidates) {
      // DAML: choice TransferPreapproval_Cancel with { p : Party } — p wajib
      // receiver atau provider DAN menjadi controller (= actAs kita).
      // MainNet 2026-08-29: arg kosong → COMMAND_PREPROCESSING_FAILED
      // "Missing non-optional fields: Set(p)".
      const { ok, status, text } = await this.exerciseChoice(
        c.contractId,
        c.templateId,
        'TransferPreapproval_Cancel',
        { p: actAs },
        [actAs],
      );
      if (ok) {
        // Extract updateId (Canton tx id) dari response untuk pencatatan history.
        let updateId: string | undefined;
        try {
          JSON.parse(text); // validasi JSON saja — throw ditangkap catch
          updateId = extractUpdateIdFromTree(text) ?? undefined;
        } catch {
          /* ignore parse error */
        }
        // Verify the contract is actually archived on-chain (with a short
        // retry to tolerate ledger archive latency). Trust nothing until the
        // authoritative read confirms it is gone.
        const gone = await this.waitForPreapprovalGone(partyId, 5, 600);
        if (gone) {
          this.logger.log(
            `TransferPreapproval cancelled & verified gone (actAs=${actAs.split('::')[0]}) updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
          );
          return { ok: true, updateId };
        }
        this.logger.warn(
          `Cancel returned ok but preapproval STILL ACTIVE after verify (actAs=${actAs.split('::')[0]})`,
        );
        lastErr = 'cancel submitted but preapproval still active after verify';
        continue;
      }
      lastErr = `Ledger ${status} (actAs=${actAs.split('::')[0]}): ${text.slice(0, 200)}`;
      this.logger.warn(`Cancel preapproval attempt failed: ${lastErr}`);
    }

    return { ok: false, error: lastErr };
  }

  /**
   * Poll the authoritative read until the preapproval is gone, up to `tries`
   * attempts spaced `delayMs` apart. Returns true once confirmed inactive.
   */
  private async waitForPreapprovalGone(
    partyId: string,
    tries: number,
    delayMs: number,
  ): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
      const status = await this.getTransferPreapprovalAuthoritative(partyId);
      if (!status.active) return true;
      await sleep(delayMs);
    }
    return false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CREATE TransferPreapproval via Ledger (Keycloak admin token).
  // Grounded on real on-chain choiceArgument (canquest-fee, tx offset 838791).
  // Provider (validator-1) pre-pays the ~1.5 CC burn fee.
  // Atomic: wrong args / insufficient funds => rejected, NO fee burned (safe to retry).
  // ───────────────────────────────────────────────────────────────────────────
  async createTransferPreapprovalViaLedger(receiverPartyId: string): Promise<{
    ok: boolean;
    transferPreapprovalCid?: string;
    amuletPaid?: string;
    updateId?: string;
    error?: string;
  }> {
    const provider = this.config.get<string>('CANTON_VALIDATOR_PARTY_ID');
    const expectedDso = this.config.get<string>('CANTON_DSO_PARTY_ID');
    if (!provider)
      return { ok: false, error: 'CANTON_VALIDATOR_PARTY_ID not set' };
    if (!expectedDso)
      return { ok: false, error: 'CANTON_DSO_PARTY_ID not set' };

    // 1) Disclosed contracts from scan-proxy (DSO-signed, with created_event_blob)
    const amuletRules = await this.fetchScanProxyContract('amulet-rules');
    if (!amuletRules)
      return { ok: false, error: 'scan-proxy /amulet-rules failed' };
    const openRound = await this.fetchScanProxyContract(
      'open-and-issuing-mining-rounds',
    );
    if (!openRound)
      return {
        ok: false,
        error: 'scan-proxy /open-and-issuing-mining-rounds failed',
      };

    // 2) Provider's Amulet input — pick largest effective holding (>= ~2 CC buffer)
    const holdings = await this.queryAmuletHoldingsRaw(provider);
    if (holdings.length === 0) {
      return {
        ok: false,
        error: `Provider ${provider} has no Amulet holding to pay preapproval fee`,
      };
    }
    const round = openRound.round ?? 0;
    const scored = holdings
      .map((h) => {
        const init = parseFloat(h.initialAmount) || 0;
        const rate = parseFloat(h.ratePerRound) || 0;
        const decay = Math.max(0, round - (h.createdAtRound || 0)) * rate;
        return { h, eff: Math.max(0, init - decay) };
      })
      .sort((a, b) => b.eff - a.eff);
    const best = scored[0];
    if (best.eff < 2) {
      return {
        ok: false,
        error: `Provider Amulet too small (eff ~${best.eff.toFixed(4)} CC) to pay preapproval fee`,
      };
    }

    // 3) expiresAt = now + 90 days (matches on-chain lifetime)
    const expiresAt = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // 4) choiceArgument — EXACT on-chain shape (offset 838791)
    const choiceArgument = {
      context: {
        amuletRules: amuletRules.contractId,
        context: {
          openMiningRound: openRound.contractId,
          issuingMiningRounds: [],
          validatorRights: [],
        },
      },
      inputs: [{ tag: 'InputAmulet', value: best.h.contractId }],
      receiver: receiverPartyId,
      provider,
      expiresAt,
      expectedDso,
    };

    const disclosedContracts = [
      {
        templateId: amuletRules.templateId,
        contractId: amuletRules.contractId,
        createdEventBlob: amuletRules.blob,
      },
      {
        templateId: openRound.templateId,
        contractId: openRound.contractId,
        createdEventBlob: openRound.blob,
      },
    ];

    this.logger.log(
      `CreateTransferPreapproval via Ledger: receiver=${receiverPartyId.slice(0, 24)}… ` +
        `round=${round} input=${best.h.contractId.slice(0, 16)}… eff~${best.eff.toFixed(2)}CC`,
    );

    const { ok, status, text } = await this.exerciseChoice(
      amuletRules.contractId,
      amuletRules.templateId,
      'AmuletRules_CreateTransferPreapproval',
      choiceArgument,
      [receiverPartyId, provider],
      `create-preapproval-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
      disclosedContracts,
    );

    if (!ok) {
      this.logger.warn(
        `CreateTransferPreapproval failed ${status}: ${text.slice(0, 400)}`,
      );
      return { ok: false, error: `Ledger ${status}: ${text.slice(0, 300)}` };
    }

    const cid = this.deepFindString(text, 'transferPreapprovalCid');
    const amuletPaid = this.deepFindString(text, 'amuletPaid');
    // Extract updateId dari response exercise (untuk link explorer Modo).
    let updateId: string | undefined;
    try {
      JSON.parse(text); // validasi JSON saja — throw ditangkap catch
      updateId = extractUpdateIdFromTree(text) ?? undefined;
    } catch {
      /* ignore parse error */
    }
    this.logger.log(
      `TransferPreapproval created cid=${(cid ?? '?').slice(0, 20)}… amuletPaid=${amuletPaid ?? '?'} updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
    );
    return {
      ok: true,
      transferPreapprovalCid: cid ?? undefined,
      amuletPaid: amuletPaid ?? undefined,
      updateId,
    };
  }

  /** Scan-proxy base (CANTON_SCAN_URL preferred, else build from CANTON_VALIDATOR_URL). */
  private scanProxyBase(): string | null {
    if (this.scanUrl) return this.scanUrl;
    const v = this.config.get<string>('CANTON_VALIDATOR_URL');
    return v ? `${v.replace(/\/$/, '')}/api/validator/v0/scan-proxy` : null;
  }

  /**
   * Fetch a DSO-signed contract (AmuletRules / current OpenMiningRound) from scan-proxy,
   * returning camelCase { contractId, templateId, blob, round? } for disclosure.
   * Scan API uses snake_case (contract_id, template_id, created_event_blob).
   */
  async fetchScanProxyContract(
    seg: 'amulet-rules' | 'open-and-issuing-mining-rounds',
  ): Promise<{
    contractId: string;
    templateId: string;
    blob: string;
    round?: number;
    /** Harga CC (Amulet) dalam USD — dari OpenMiningRound.payload.amuletPrice. */
    amuletPrice?: number;
  } | null> {
    const base = this.scanProxyBase();
    if (!base) {
      this.logger.error(
        'scan-proxy base not configured (CANTON_SCAN_URL / CANTON_VALIDATOR_URL)',
      );
      return null;
    }
    const hostHeader =
      this.config.get<string>('CANTON_VALIDATOR_HOST_HEADER') ?? '';
    try {
      const headers = await this.authHeaders();
      if (hostHeader) headers['Host'] = hostHeader;
      const res = await fetch(`${base}/${seg}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        this.logger.warn(
          `scan-proxy /${seg} ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
        return null;
      }
      const data = await res.json();

      // collect every embedded contract { template_id, contract_id, created_event_blob, payload? }
      const found: Array<{
        contractId: string;
        templateId: string;
        blob: string;
        round?: number;
        opensAt?: string;
        amuletPrice?: number;
      }> = [];
      const walk = (n: unknown, seen = new Set<unknown>()): void => {
        if (!n || typeof n !== 'object' || seen.has(n)) return;
        seen.add(n);
        const o = n as Record<string, any>;
        if (
          typeof o.contract_id === 'string' &&
          typeof o.template_id === 'string' &&
          typeof o.created_event_blob === 'string'
        ) {
          const payload = o.payload ?? {};
          found.push({
            contractId: o.contract_id,
            templateId: o.template_id,
            blob: o.created_event_blob,
            round:
              payload?.round?.number != null
                ? Number(payload.round.number)
                : undefined,
            opensAt:
              typeof payload?.opensAt === 'string'
                ? payload.opensAt
                : undefined,
            // Harga CC (Amulet) USD — dari OpenMiningRound.payload.amuletPrice.
            // Bisa berupa string numeric atau number; parse aman.
            amuletPrice:
              payload?.amuletPrice != null
                ? Number(payload.amuletPrice)
                : undefined,
          });
        }
        for (const k of Object.keys(o)) walk(o[k], seen);
      };
      walk(data);

      if (seg === 'amulet-rules') {
        return (
          found.find((c) =>
            c.templateId.endsWith(':Splice.AmuletRules:AmuletRules'),
          ) ??
          found[0] ??
          null
        );
      }
      // open-and-issuing-mining-rounds: pick a currently-OPEN round, highest round number
      const open = found.filter((c) =>
        c.templateId.endsWith(':Splice.Round:OpenMiningRound'),
      );
      if (open.length === 0) {
        this.logger.warn('scan-proxy: no OpenMiningRound found');
        return null;
      }
      const now = Date.now();
      const usable = open.filter(
        (c) => !c.opensAt || Date.parse(c.opensAt) <= now,
      );
      const pick = (usable.length ? usable : open).sort(
        (a, b) => (b.round ?? 0) - (a.round ?? 0),
      )[0];
      return pick ?? null;
    } catch (err) {
      this.logger.warn(`scan-proxy /${seg} error: ${String(err)}`);
      return null;
    }
  }

  /**
   * Harga CC (Amulet) dalam USD dari scan-proxy OpenMiningRound.
   *
   * Sumber resmi Canton (scan-proxy/open-and-issuing-mining-rounds →
   * payload.amuletPrice). Bila gagal / field tidak ada → return null
   * (caller wajib handle: pakai cache lama atau skip harga CC).
   *
   * Dipakai CantonPriceService untuk /party/prices.
   */
  async getAmuletPrice(): Promise<number | null> {
    const round = await this.fetchScanProxyContract(
      'open-and-issuing-mining-rounds',
    );
    if (
      !round ||
      round.amuletPrice == null ||
      !Number.isFinite(round.amuletPrice)
    ) {
      this.logger.warn(
        'getAmuletPrice: amuletPrice tidak ditemukan di OpenMiningRound payload',
      );
      return null;
    }
    return round.amuletPrice;
  }

  /** Best-effort: parse a JSON response and return the first string value for `key`. */
  private deepFindString(jsonText: string, key: string): string | null {
    let root: unknown;
    try {
      root = JSON.parse(jsonText);
    } catch {
      return null;
    }
    let out: string | null = null;
    const walk = (n: unknown, seen = new Set<unknown>()): void => {
      if (out !== null || !n || typeof n !== 'object' || seen.has(n)) return;
      seen.add(n);
      const o = n as Record<string, unknown>;
      if (typeof o[key] === 'string') {
        out = o[key];
        return;
      }
      for (const k of Object.keys(o)) walk(o[k], seen);
    };
    walk(root);
    return out;
  }

  /**
   * Get choiceContext from registry for accept/reject/withdraw on a TransferInstruction.
   * Calls: POST /registry/transfer-instruction/v1/{id}/choice-contexts/{action}
   */
  /**
   * Detect apakah instrument adalah CC (Amulet) berdasarkan instrumentAdmin.
   * CC path pakai Scan-proxy Splice (built-in). Non-CC pakai Utility Registry API.
   * Branching: CC = admin DSO/Amulet; non-CC = registrar lain (Circle, BitSafe, dll).
   */
  private isCcInstrumentAdmin(instrumentAdmin: string): boolean {
    if (!instrumentAdmin) return true; // default CC (backward compat offers lama)
    const a = instrumentAdmin.toLowerCase();
    return (
      a.startsWith('dso::') || a.includes('amulet') || a.includes('splice')
    );
  }

  /**
   * Build URL untuk choice-context berdasarkan jenis instrument:
   *   CC (Amulet)        → Scan-proxy Splice (existing path, unchanged)
   *   Non-CC (USDCx dll) → Utility Registry API (registrar-specific URL)
   *
   * Non-CC URL format (per dokumentasi CIP-0056 + Utility Registry):
   *   ${UTILITY_REGISTRY_BASE_URL}/api/token-standard/v0/registrars/${registrarPartyId}/registry/transfer-instruction/v1/${cid}/choice-contexts/${action}
   *
   * registrarPartyId = instrumentAdmin dari kontrak (Circle's party untuk USDCx).
   * UTILITY_REGISTRY_BASE_URL configurable via env (MainNet: api.utilities.digitalasset.com).
   */
  private buildChoiceContextUrls(
    transferInstructionCid: string,
    action: 'accept' | 'reject' | 'withdraw',
    instrumentAdmin: string,
  ): string[] {
    const encodedCid = encodeURIComponent(transferInstructionCid);

    if (this.isCcInstrumentAdmin(instrumentAdmin)) {
      // CC path: Scan-proxy Splice (existing, unchanged).
      const validatorUrl = (
        this.config.get<string>('CANTON_VALIDATOR_URL') ??
        'http://127.0.0.1:8080'
      ).replace(/\/$/, '');
      const scanBase = `${validatorUrl}/api/validator/v0/scan-proxy`;
      return [
        `${scanBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/${action}`,
        `${scanBase}/registry/transfer-instruction/v1/${transferInstructionCid}/choice-contexts/${action}`,
      ];
    }

    // Non-CC path: Utility Registry API.
    // registrarPartyId = instrumentAdmin (Circle's party untuk USDCx).
    const registryBase = (
      this.config.get<string>('UTILITY_REGISTRY_BASE_URL') ??
      'https://api.utilities.digitalasset.com'
    ).replace(/\/$/, '');
    const registrarPartyId = encodeURIComponent(instrumentAdmin);
    return [
      `${registryBase}/api/token-standard/v0/registrars/${registrarPartyId}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/${action}`,
      `${registryBase}/api/token-standard/v0/registrars/${registrarPartyId}/registry/transfer-instruction/v1/${transferInstructionCid}/choice-contexts/${action}`,
    ];
  }

  async getInstructionChoiceContext(
    transferInstructionCid: string,
    action: 'accept' | 'reject' | 'withdraw',
    instrumentAdmin: string,
  ): Promise<{
    choiceContextData: Record<string, unknown>;
    disclosedContracts: unknown[];
  } | null> {
    const isCc = this.isCcInstrumentAdmin(instrumentAdmin);
    const hostHeader =
      this.config.get<string>('CANTON_VALIDATOR_HOST_HEADER') ?? '';

    const urlVariants = this.buildChoiceContextUrls(
      transferInstructionCid,
      action,
      instrumentAdmin,
    );

    this.logger.log(
      `Choice context (${action}) ${isCc ? 'CC path (Scan-proxy)' : 'Registry token path (Utility Registry API)'} ` +
        `admin=${instrumentAdmin.slice(0, 24)}… cid=${transferInstructionCid.slice(0, 16)}…`,
    );

    // Headers: CC path butuh Host header + Keycloak token.
    // Registry API butuh Authorization Bearer (Keycloak token OK cross-domain).
    const headers = await this.authHeaders();
    if (isCc && hostHeader) headers['Host'] = hostHeader;

    for (let i = 0; i < urlVariants.length; i++) {
      const url = urlVariants[i];
      try {
        this.logger.debug(
          `Choice context (${action}) try ${i + 1}/${urlVariants.length}: ${url.slice(0, 120)}…`,
        );
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ meta: {}, excludeDebugFields: false }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          const text = await res.text();
          this.logger.warn(
            `Choice context (${action}) try ${i + 1} ${res.status}: ${text.slice(0, 200)}\n` +
              `  URL: ${url}`,
          );
          continue; // coba varian berikutnya
        }

        const data = (await res.json()) as {
          choiceContextData?: Record<string, unknown>;
          disclosedContracts?: unknown[];
        };

        // Log detail untuk diagnose "Missing context entry for transfer-rule".
        const ctxKeys = data.choiceContextData
          ? Object.keys(data.choiceContextData)
          : [];
        const hasTransferRule = ctxKeys.some(
          (k) =>
            k.toLowerCase().includes('transfer-rule') ||
            k.toLowerCase().includes('transferrule'),
        );
        this.logger.log(
          `Choice context (${action}) OK: disclosed=${data.disclosedContracts?.length ?? 0} ` +
            `contextKeys=[${ctxKeys.join(',')}] hasTransferRule=${hasTransferRule} ` +
            `cid=${transferInstructionCid.slice(0, 16)}… (variant ${i + 1})`,
        );
        if (!hasTransferRule) {
          this.logger.warn(
            `Choice context (${action}) TIDAK ada transfer-rule entry! ` +
              `Accept kemungkinan gagal dengan "Missing context entry for transfer-rule".`,
          );
        }

        return {
          choiceContextData: data.choiceContextData ?? { values: {} },
          disclosedContracts: data.disclosedContracts ?? [],
        };
      } catch (err) {
        this.logger.warn(
          `Choice context (${action}) try ${i + 1} error: ${String(err)}`,
        );
      }
    }

    // Semua varian gagal.
    this.logger.error(
      `Choice context (${action}) SEMUA varian URL gagal. ` +
        `CID=${transferInstructionCid.slice(0, 24)}… admin=${instrumentAdmin.slice(0, 24)}…\n` +
        `Path: ${isCc ? 'CC (Scan-proxy)' : 'Registry token (Utility Registry API)'}\n` +
        `Saran: kalau registry token, cek UTILITY_REGISTRY_BASE_URL + ` +
        `registrarPartyId (${instrumentAdmin.slice(0, 30)}…) cocok dengan ` +
        `instrumentId.admin di kontrak.`,
    );
    return null;
  }

  /**
   * CIP-0056 Two-Step Transfer — STEP 2A: RECEIVER menerima TransferInstruction.
   *
   * Interface: Splice.Api.Token.TransferInstructionV1:TransferInstruction
   * Choice:    TransferInstruction_Accept
   * Argument:  { extraArgs: { context: choiceContextData, meta: {} } }
   *
   * Requires registry call to get disclosedContracts + choiceContextData.
   * Registry: POST /registry/transfer-instruction/v1/{id}/choice-contexts/accept
   *
   * @param transferInstructionCid - ContractId dari TransferInstruction (dari Step 1)
   * @param receiverPartyId - Canton party ID penerima (controller choice ini)
   * @returns { ok, updateId, error }
   */
  async acceptTransferInstruction(
    transferInstructionCid: string,
    receiverPartyId: string,
  ): Promise<{ ok: boolean; updateId: string | null; error?: string }> {
    const interfaceId =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

    const commandId = `accept-instruction-${transferInstructionCid.slice(0, 16)}-${randomUUID().slice(0, 8)}`;

    this.logger.log(
      `TransferInstruction_Accept: receiver=${receiverPartyId.split('::')[0]} cid=${transferInstructionCid.slice(0, 16)}...`,
    );

    // Lookup offer detail untuk dapat instrumentAdmin (branch CC vs registry token).
    // Default CC (admin kosong) kalau lookup gagal.
    let instrumentAdmin = '';
    try {
      const detail = await this.lookupOfferDetail(
        transferInstructionCid,
        receiverPartyId,
      );
      if (detail?.instrumentAdmin) {
        instrumentAdmin = detail.instrumentAdmin;
        this.logger.log(
          `Accept instrumentAdmin detected: ${instrumentAdmin.slice(0, 30)}… ` +
            `(${this.isCcInstrumentAdmin(instrumentAdmin) ? 'CC' : 'registry token'})`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `lookupOfferDetail failed saat accept: ${String(err)} — fallback CC path`,
      );
    }

    // Get choiceContext dari registry (required for disclosedContracts).
    // CC: Scan-proxy Splice. Non-CC: Utility Registry API.
    // Kalau null = registry endpoint 404/error → fail loudly.
    const choiceCtx = await this.getInstructionChoiceContext(
      transferInstructionCid,
      'accept',
      instrumentAdmin,
    );
    if (!choiceCtx) {
      return {
        ok: false,
        updateId: null,
        error:
          'Failed to fetch choice context from registry (404/error). ' +
          'Accept requires TransferRule disclosed contract. ' +
          `InstrumentAdmin: ${instrumentAdmin || '(empty=CC)'}. ` +
          'Kalau registry token, cek UTILITY_REGISTRY_BASE_URL + registrarPartyId.',
      };
    }

    const choiceArgument = {
      extraArgs: {
        context: choiceCtx.choiceContextData,
        meta: { values: {} },
      },
    };

    const { ok, status, text } = await this.exerciseChoice(
      transferInstructionCid,
      interfaceId,
      'TransferInstruction_Accept',
      choiceArgument,
      [receiverPartyId],
      commandId,
      'submit-and-wait-for-transaction-tree',
      choiceCtx?.disclosedContracts,
    );

    if (ok) {
      let updateId: string | null = null;
      try {
        JSON.parse(text); // validasi JSON saja — throw ditangkap catch
        updateId = extractUpdateIdFromTree(text) ?? null;
      } catch {
        /* ignore */
      }
      this.logger.log(
        `TransferInstruction_Accept succeeded: updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
      );
      return { ok: true, updateId };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(`TransferInstruction_Accept failed ${status}: ${errMsg}`);
    return { ok: false, updateId: null, error: errMsg };
  }

  /**
   * CIP-0056 Two-Step Transfer — STEP 2B: RECEIVER menolak TransferInstruction.
   *
   * Interface: Splice.Api.Token.TransferInstructionV1:TransferInstruction
   * Choice:    TransferInstruction_Reject
   * Argument:  { extraArgs: { values: {} } }
   *
   * Holding CC dikembalikan ke sender. Status menjadi TransferInstructionResult_Failed.
   *
   * @param transferInstructionCid - ContractId dari TransferInstruction (dari Step 1)
   * @param receiverPartyId - Canton party ID penerima (controller choice ini)
   * @returns { ok, updateId, error }
   */
  async rejectTransferInstruction(
    transferInstructionCid: string,
    receiverPartyId: string,
  ): Promise<{ ok: boolean; updateId: string | null; error?: string }> {
    const interfaceId =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

    const commandId = `reject-instruction-${transferInstructionCid.slice(0, 16)}-${randomUUID().slice(0, 8)}`;

    this.logger.log(
      `TransferInstruction_Reject: receiver=${receiverPartyId.split('::')[0]} cid=${transferInstructionCid.slice(0, 16)}...`,
    );

    // Lookup offer detail untuk dapat instrumentAdmin (branch CC vs registry token).
    let instrumentAdmin = '';
    try {
      const detail = await this.lookupOfferDetail(
        transferInstructionCid,
        receiverPartyId,
      );
      if (detail?.instrumentAdmin) instrumentAdmin = detail.instrumentAdmin;
    } catch {
      /* fallback CC path */
    }

    const choiceCtx = await this.getInstructionChoiceContext(
      transferInstructionCid,
      'reject',
      instrumentAdmin,
    );

    const { ok, status, text } = await this.exerciseChoice(
      transferInstructionCid,
      interfaceId,
      'TransferInstruction_Reject',
      {
        extraArgs: {
          context: choiceCtx?.choiceContextData ?? { values: {} },
          meta: { values: {} },
        },
      },
      [receiverPartyId],
      commandId,
      undefined,
      choiceCtx?.disclosedContracts,
    );

    if (ok) {
      let updateId: string | null = null;
      try {
        JSON.parse(text); // validasi JSON saja — throw ditangkap catch
        updateId = extractUpdateIdFromTree(text) ?? null;
      } catch {
        /* ignore */
      }
      this.logger.log(
        `TransferInstruction_Reject succeeded: updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
      );
      return { ok: true, updateId };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(`TransferInstruction_Reject failed ${status}: ${errMsg}`);
    return { ok: false, updateId: null, error: errMsg };
  }

  /**
   * CIP-0056 Two-Step Transfer — STEP 2C: SENDER membatalkan TransferInstruction.
   *
   * Interface: Splice.Api.Token.TransferInstructionV1:TransferInstruction
   * Choice:    TransferInstruction_Withdraw
   *
   * Sender membatalkan transfer sebelum receiver accept/reject.
   * Holding CC dikembalikan ke sender.
   *
   * CIP-0056 mengharuskan withdraw membawa extraArgs { context, meta } +
   * disclosedContracts dari registry choice-contexts API (sama seperti accept/
   * reject). Sebelumnya withdraw hanya kirim { values: {} } → Canton reject
   * dengan COMMAND_PREPROCESSING_FAILED "Missing non-optional fields: Set(context, meta)".
   *
   * @param transferInstructionCid - ContractId dari TransferInstruction (dari Step 1)
   * @param senderPartyId - Canton party ID pengirim (controller choice ini)
   * @param instrumentAdmin - Admin party instrument (untuk branch CC vs registry token
   *   saat ambil choice-context). Kosong = default CC path.
   * @returns { ok, updateId, error }
   */
  async withdrawTransferInstruction(
    transferInstructionCid: string,
    senderPartyId: string,
    instrumentAdmin = '',
  ): Promise<{ ok: boolean; updateId: string | null; error?: string }> {
    const interfaceId =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

    const commandId = `withdraw-instruction-${transferInstructionCid.slice(0, 16)}-${randomUUID().slice(0, 8)}`;

    this.logger.log(
      `TransferInstruction_Withdraw: sender=${senderPartyId.split('::')[0]} cid=${transferInstructionCid.slice(0, 16)}...`,
    );

    // Ambil choice-context dari registry (sama seperti accept/reject). CIP-0056
    // mewajibkan extraArgs { context, meta } + disclosedContracts — tanpa ini
    // Canton reject: "Missing non-optional fields: Set(context, meta)".
    const choiceCtx = await this.getInstructionChoiceContext(
      transferInstructionCid,
      'withdraw',
      instrumentAdmin,
    );

    const { ok, status, text } = await this.exerciseChoice(
      transferInstructionCid,
      interfaceId,
      'TransferInstruction_Withdraw',
      {
        extraArgs: {
          context: choiceCtx?.choiceContextData ?? { values: {} },
          meta: { values: {} },
        },
      },
      [senderPartyId],
      commandId,
      undefined,
      choiceCtx?.disclosedContracts,
    );

    if (ok) {
      let updateId: string | null = null;
      try {
        JSON.parse(text); // validasi JSON saja — throw ditangkap catch
        updateId = extractUpdateIdFromTree(text) ?? null;
      } catch {
        /* ignore */
      }
      this.logger.log(
        `TransferInstruction_Withdraw succeeded: updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
      );
      return { ok: true, updateId };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(
      `TransferInstruction_Withdraw failed ${status}: ${errMsg}`,
    );
    return { ok: false, updateId: null, error: errMsg };
  }

  /**
   * Accept a Splice TransferOffer on behalf of the receiver party.
   *
   * Template: Splice.Wallet.TransferOffer:TransferOffer
   * Choice:   TransferOffer_Accept (controller = receiver, no arguments)
   *
   * Returns { accepted: boolean, updateId: string | null }
   */
  async acceptTransferOffer(
    offerContractId: string,
    receiverPartyId: string,
  ): Promise<{ accepted: boolean; updateId: string | null }> {
    const templateId =
      '94d88246f69d8a4b69333d1f993e3280deaca19b70511ea7687f01e4328a34a4:Splice.Wallet.TransferOffer:TransferOffer';

    const { ok, status, text } = await this.exerciseChoice(
      offerContractId,
      templateId,
      'TransferOffer_Accept',
      {},
      [receiverPartyId],
    );

    if (ok) {
      let updateId: string | null = null;
      try {
        JSON.parse(text); // validasi JSON saja — throw ditangkap catch
        updateId = extractUpdateIdFromTree(text) ?? null;
      } catch {
        /* ignore */
      }
      this.logger.log(
        `TransferOffer accepted: ${receiverPartyId.split('::')[0]} updateId: ${updateId ?? 'unknown'}`,
      );
      return { accepted: true, updateId };
    }
    this.logger.warn(`TransferOffer_Accept ${status}: ${text.slice(0, 300)}`);
    return { accepted: false, updateId: null };
  }

  /**
   * Reject a Splice TransferOffer on behalf of the receiver party.
   *
   * Template: Splice.Wallet.TransferOffer:TransferOffer
   * Choice:   TransferOffer_Reject (controller = receiver, no arguments)
   *
   * Returns { rejected: boolean, updateId: string | null }
   */
  async rejectTransferOffer(
    offerContractId: string,
    receiverPartyId: string,
  ): Promise<{ rejected: boolean; updateId: string | null }> {
    const templateId =
      '94d88246f69d8a4b69333d1f993e3280deaca19b70511ea7687f01e4328a34a4:Splice.Wallet.TransferOffer:TransferOffer';

    const { ok, status, text } = await this.exerciseChoice(
      offerContractId,
      templateId,
      'TransferOffer_Reject',
      {},
      [receiverPartyId],
    );

    if (ok) {
      let updateId: string | null = null;
      try {
        JSON.parse(text); // validasi JSON saja — throw ditangkap catch
        updateId = extractUpdateIdFromTree(text) ?? null;
      } catch {
        /* ignore */
      }
      this.logger.log(
        `TransferOffer rejected: ${receiverPartyId.split('::')[0]} updateId: ${updateId ?? 'unknown'}`,
      );
      return { rejected: true, updateId };
    }
    this.logger.warn(`TransferOffer_Reject ${status}: ${text.slice(0, 300)}`);
    return { rejected: false, updateId: null };
  }

  /**
   * Allocate a new internal party on the connected participant node.
   *
   * POST /v2/parties
   * Body: { partyIdHint: string, identityProviderId: "" }
   *
   * Returns the full Canton Party identifier, e.g.:
   *   "alice_canton::122084768362d0ce21f1ffec870e55e365a292cdf8f54c5c38ad7775b9bdd462e141"
   *
   * Note: This creates an *internal* party (participant manages signing keys).
   * For external parties (user-controlled keys), see the Splice external party
   * onboarding docs: https://docs.digitalasset.com/build/3.5/quickstart/operate/how-to-onboard-external-parties-in-quickstart.html
   */
  async allocateParty(partyIdHint: string): Promise<string> {
    const url = `${this.baseUrl}/v2/parties`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({ partyIdHint, identityProviderId: '' }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      this.logger.error(`Canton JSON API fetch failed: ${String(err)}`);
      throw new ServiceUnavailableException(
        'Cannot reach Canton JSON Ledger API. ' +
          'Check CANTON_JSON_API_URL and your SSH tunnel to the participant node.',
      );
    }

    const text = await res.text();

    if (!res.ok) {
      this.logger.error(`Canton /v2/parties ${res.status}: ${text}`);
      throw new ServiceUnavailableException(
        `Canton Ledger API returned ${res.status}. Details: ${text.slice(0, 300)}`,
      );
    }

    let data: { partyDetails?: { party?: string } };
    try {
      data = JSON.parse(text) as { partyDetails?: { party?: string } };
    } catch {
      throw new ServiceUnavailableException(
        'Canton returned non-JSON response.',
      );
    }

    const partyId = data?.partyDetails?.party;
    if (!partyId) {
      throw new ServiceUnavailableException(
        'Canton response did not contain partyDetails.party. Check participant version.',
      );
    }

    this.logger.log(`Party allocated: ${partyId} (hint: ${partyIdHint})`);

    // Grant ledger-api-user the rights to act as this new party.
    // Required so the backend can submit commands on behalf of the party
    // (e.g. creating TransferPreapproval, accepting transfer offers).
    await this.grantUserRights(partyId).catch((err) =>
      this.logger.warn(`grantUserRights failed: ${String(err)}`),
    );

    return partyId;
  }

  /**
   * Grant ledger-api-user canActAs + canReadAs rights for a party.
   * POST /v2/users/ledger-api-user/rights
   */
  async grantUserRights(partyId: string): Promise<void> {
    const url = `${this.baseUrl}/v2/users/${encodeURIComponent(this.ledgerApiUser)}/rights`;
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        identityProviderId: '',
        userId: this.ledgerApiUser,
        rights: [
          { kind: { CanActAs: { value: { party: partyId } } } },
          { kind: { CanReadAs: { value: { party: partyId } } } },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const t = await res.text();
      this.logger.warn(`grantUserRights ${res.status}: ${t.slice(0, 200)}`);
    } else {
      this.logger.log(`Granted ledger-api-user rights for party: ${partyId}`);
    }
  }

  /**
   * Grant CanReadAs SAJA untuk party external (non-custodial).
   *
   * Read = sink saldo/ACS server-side tetap jalan; Act sengaja TIDAK diberikan —
   * M0 membuktikan participant menolak submit actAs external party, tapi
   * higienisnya rights penulisan tidak pernah di-grant untuk wallet user.
   */
  async grantReadRightsOnParty(partyId: string): Promise<void> {
    const url = `${this.baseUrl}/v2/users/${encodeURIComponent(this.ledgerApiUser)}/rights`;
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify({
        identityProviderId: '',
        userId: this.ledgerApiUser,
        rights: [{ kind: { CanReadAs: { value: { party: partyId } } } }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const t = await res.text();
      this.logger.warn(`grantReadRightsOnParty ${res.status}: ${t.slice(0, 200)}`);
    } else {
      this.logger.log(`Granted CanReadAs (only) for external party: ${partyId.split('::')[0]}`);
    }
  }

  /** Ambil current mining round dari Validator API (admin Keycloak token). */
  /**
   * Ambil nomor round Canton saat ini dari validator balance endpoint.
   *
   * NON-FATAL: bila validator/Keycloak sementara unavailable (401/network),
   * return 0 + log warn — JANGAN throw. Ini dipanggil oleh background sync
   * (cc-inbound-sync) untuk semua user; satu failure tidak boleh crash app.
   * Caller wajib handle round=0 sebagai "tidak diketahui".
   */
  async getCurrentRound(): Promise<number> {
    if (!this.keycloak) {
      this.logger.warn('getCurrentRound: KeycloakTokenService not injected');
      return 0;
    }
    try {
      const token = await this.keycloak.getAdminLedgerToken();
      const validatorUrl = (
        this.config.get<string>('CANTON_VALIDATOR_URL') ?? ''
      ).replace(/\/$/, '');
      const res = await fetch(
        `${validatorUrl}/api/validator/v0/wallet/balance`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) {
        this.logger.warn(
          `getCurrentRound HTTP ${res.status} (non-fatal, return 0)`,
        );
        return 0;
      }
      const data = (await res.json()) as { round?: number };
      if (!data.round) {
        this.logger.warn('getCurrentRound: field round tidak ditemukan');
        return 0;
      }
      return data.round;
    } catch (err) {
      this.logger.warn(`getCurrentRound error (non-fatal): ${String(err)}`);
      return 0;
    }
  }

  /**
   * Query ACS Amulet holdings dengan data lengkap (initialAmount, createdAtRound, ratePerRound).
   * Hanya menyaring kontrak yang templateId-nya berakhiran :Splice.Amulet:Amulet milik party.
   */
  async queryAmuletHoldingsRaw(partyId: string): Promise<
    Array<{
      contractId: string;
      initialAmount: string;
      createdAtRound: number;
      ratePerRound: string;
    }>
  > {
    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }
    // SAFETY: JANGAN query ACS dengan activeAtOffset=0. Offset 0 = genesis =
    // ACS kosong. Dulu, saat ledgerEnd gagal (timeout 6s / proxy 502), offset
    // fallback 0 → response [] yang VALID → getLedgerBalance return 0 →
    // poller menulis saldo 0 ke DB (saldo user "hilang") atau delta masuk
    // tidak pernah terdeteksi. Kalau ledger-end tidak terbaca, THROW supaya
    // caller mempertahankan saldo DB lama.
    if (!offset || offset === '0') {
      throw new Error(
        'queryAmuletHoldingsRaw: ledger-end offset unavailable — refusing to query ACS at offset 0 (empty-state phantom)',
      );
    }

    const filtersByParty: Record<string, unknown> = {
      [partyId]: {
        cumulative: [
          {
            identifierFilter: {
              WildcardFilter: { value: { includeCreatedEventBlob: false } },
            },
          },
        ],
      },
    };

    let allContracts: unknown[] = [];
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({
          eventFormat: { filtersByParty, verbose: true },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        // THROW, bukan return [] — sebelumnya error di sini menyebabkan
        // getLedgerBalance() return 0, lalu alignBalanceFromChain OVERWRITE
        // balance DB jadi 0. Dengan throw, caller's try/catch aktif dan
        // balance lama di DB dipertahankan. (Fix "data ilang".)
        const text = await res.text();
        throw new Error(
          `queryAmuletHoldingsRaw ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      allContracts = (await res.json()) as unknown[];
      if (!Array.isArray(allContracts)) allContracts = [];
    } catch (err) {
      this.logger.warn(`queryAmuletHoldingsRaw error: ${String(err)}`);
      throw err;
    }

    const results: Array<{
      contractId: string;
      initialAmount: string;
      createdAtRound: number;
      ratePerRound: string;
    }> = [];
    for (const entry of allContracts) {
      if (!entry || typeof entry !== 'object') continue;
      const wrapper = entry as Record<string, unknown>;
      const active = wrapper.contractEntry as
        | Record<string, unknown>
        | undefined;
      const jsActive = active?.JsActiveContract as
        | Record<string, unknown>
        | undefined;
      const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;
      const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
      if (!tplId.endsWith(':Splice.Amulet:Amulet')) continue;
      const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};
      const owner = typeof args.owner === 'string' ? args.owner : '';
      if (!cantonPartyIdsEqual(owner, partyId)) continue;
      if (!cid) continue;
      const amt = args.amount as Record<string, unknown> | undefined;
      if (!amt) continue;
      results.push({
        contractId: cid,
        initialAmount:
          typeof amt.initialAmount === 'string' ? amt.initialAmount : '0',
        createdAtRound: (amt.createdAt as Record<string, unknown> | undefined)
          ?.number
          ? Number((amt.createdAt as Record<string, unknown>).number)
          : 0,
        ratePerRound: (amt.ratePerRound as Record<string, unknown> | undefined)
          ?.rate
          ? String((amt.ratePerRound as Record<string, unknown>).rate)
          : '0',
      });
    }
    return results;
  }

  /**
   * Hitung balance CC dari Ledger API.
   * Formula per Amulet: max(0, initialAmount - max(0, currentRound - createdAtRound) × ratePerRound).
   */
  async getLedgerBalance(partyId: string): Promise<number> {
    const holdings = await this.queryAmuletHoldingsRaw(partyId);
    if (holdings.length === 0) return 0;
    const currentRound = await this.getCurrentRound();
    let total = 0;
    for (const h of holdings) {
      const effective = Math.max(
        0,
        parseFloat(h.initialAmount) -
          Math.max(0, currentRound - h.createdAtRound) *
            parseFloat(h.ratePerRound),
      );
      total += effective;
    }
    // Hot path: getLedgerBalance dipanggil tiap poll sync (30s) & per-request
    // balance. Gate dengan DEBUG_LEDGER supaya template string tidak jalan.
    if (DEBUG_LEDGER) {
      this.logger.verbose(
        `Balance Ledger: party=${partyId.split('::')[0]} = ${total} CC (${holdings.length} Amulets, round ${currentRound})`,
      );
    }
    return total;
  }

  /** Returns current ledger-end offset. */
  async ledgerEnd(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/v2/state/ledger-end`, {
      headers: await this.authHeaders(),
      signal: AbortSignal.timeout(6_000),
    });
    const text = await res.text();
    if (!res.ok)
      throw new ServiceUnavailableException(`Canton ledger-end ${res.status}`);
    return JSON.parse(text);
  }

  /**
   * Query the Active Contract Set (ACS) for Amulet holdings owned by a party.
   *
   * Uses POST /v2/state/active-contracts with a TemplateFilter for Splice.Amulet:Amulet.
   * Returns contracts where the owner field matches the given partyId.
   *
   * Per Token Standard documentation:
   * https://docs.canton.network/appdev/deep-dives/token-standard.md
   *
   * @param ownerPartyId - Canton party ID of the holding owner
   * @param readAs - parties with read rights
   * @returns Array of { contractId, amount (Decimal as string) }
   */
  async queryAmuletHoldings(
    ownerPartyId: string,
    readAs?: string[],
  ): Promise<Array<{ contractId: string; amount: string }>> {
    const effectiveReadAs = readAs ?? [ownerPartyId];

    // MainNet splice-amulet uses full package hash which TemplateFilter rejects.
    // Solution: WildcardFilter + client-side filter for Splice.Amulet:Amulet.
    // This is safe because we filter by owner party AND template name.
    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }
    // SAFETY (mirror queryAmuletHoldingsRaw): offset 0 = genesis = ACS kosong.
    // Dulu failure ledgerEnd → offset 0 → response [] VALID → caller melihat
    // "tidak punya Amulet" padahal hanya query gagal (phantom empty). THROW.
    if (!offset || offset === '0') {
      throw new Error(
        'queryAmuletHoldings: ledger-end offset unavailable — refusing to query ACS at offset 0 (empty-state phantom)',
      );
    }

    const filtersByParty: Record<string, unknown> = {};
    for (const party of effectiveReadAs) {
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

    let allContracts: unknown[] = [];
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({
          eventFormat: {
            filtersByParty,
            verbose: true,
          },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        allContracts = (await res.json()) as unknown[];
        if (!Array.isArray(allContracts)) allContracts = [];
      } else {
        // THROW, bukan warn + lanjut dengan [] — response kosong palsu membuat
        // caller (validasi saldo send/swap/lock) menganggap user tidak punya
        // Amulet padahal query gagal (proxy 502 / timeout).
        const text = await res.text();
        throw new Error(
          `queryAmuletHoldings wildcard ${res.status}: ${text.slice(0, 200)}`,
        );
      }
    } catch (err) {
      this.logger.warn(`queryAmuletHoldings error: ${String(err)}`);
      throw err;
    }

    // Client-side filter: only Splice.Amulet:Amulet contracts owned by this party
    const holdings: Array<{ contractId: string; amount: string }> = [];
    for (const entry of allContracts) {
      if (!entry || typeof entry !== 'object') continue;
      const wrapper = entry as Record<string, unknown>;
      const active = wrapper.contractEntry as
        | Record<string, unknown>
        | undefined;
      const jsActive = active?.JsActiveContract as
        | Record<string, unknown>
        | undefined;
      const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;

      const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
      if (!tplId.includes('Splice.Amulet:Amulet')) continue;

      const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};

      if (!cid) continue;

      // Check owner
      const cOwner = typeof args.owner === 'string' ? args.owner : '';
      if (cOwner && cOwner !== ownerPartyId) continue;

      // Extract amount from ExpiringAmount
      const amtRaw = args.amount as Record<string, unknown> | undefined;
      const amountStr =
        typeof amtRaw?.initialAmount === 'string'
          ? amtRaw.initialAmount
          : typeof amtRaw?.amount === 'string'
            ? amtRaw.amount
            : typeof args.amount === 'string'
              ? args.amount
              : '0';

      holdings.push({ contractId: cid, amount: amountStr });
    }

    // Hot path: queryTokenHoldings dipanggil per-request balance & per-poll sync.
    // Gate dengan DEBUG_LEDGER supaya template string tidak jalan tiap poll.
    if (DEBUG_LEDGER) {
      this.logger.verbose(
        `Amulet ACS query (wildcard): party=${ownerPartyId.split('::')[0]} found ${holdings.length} holdings from ${allContracts.length} total contracts`,
      );
    }
    return holdings;
  }
  /**
   * Query token holdings via InterfaceFilter — AUTHORITATIVE on-chain read.
   *
   * Ini method utama untuk baca saldo token (USDCx, CBTC, dll) langsung dari
   * ledger sesuai state on-chain TERKINI, BUKAN dari DB off-chain.
   *
   * KENAPA BUTUH INI:
   *   Alternatif WildcardFilter TIDAK match contract yang hanya visible via
   *   interface. Token standard (USDCx = `Utility.Registry.Holding.V0:Holding`)
   *   terekspos via interface `HoldingV1`, BUKAN template langsung. Itu sebabnya
   *   WildcardFilter return [] padahal holding itu ADA (dibuktikan WSS stream
   *   lihat created/archived event untuk party tsb).
   *
   *   FIX: pakai InterfaceFilter dengan interface ID
   *   `#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding`.
   *   Format `#package-name:Module:Entity` (package name reference) aman dari
   *   masalah full-hash mainnet (tidak perlu tahu hash package).
   *
   * @param partyId - Canton party ID pemilik (WAJIB — filtersByParty scope per party)
   * @returns Map instrumentId(lowercase) → total amount (sum across holdings).
   *          Kosong {} kalau party tidak pegang token apa pun (bukan error).
   */
  async queryTokenHoldingsByInterface(
    partyId: string,
  ): Promise<Record<string, number>> {
    if (!partyId) return {};

    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }

    // InterfaceFilter per Canton docs (jawaban AI Canton):
    //   interfaceId pakai package-name reference (#splice-api-token-holding-v1)
    //   supaya gak kena masalah full-hash mainnet.
    const filtersByParty: Record<string, unknown> = {
      [partyId]: {
        cumulative: [
          {
            identifierFilter: {
              InterfaceFilter: {
                value: {
                  interfaceId:
                    '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
                  includeInterfaceView: true,
                  includeCreatedEventBlob: false,
                },
              },
            },
          },
        ],
      },
    };

    let allContracts: unknown[] = [];
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({
          eventFormat: { filtersByParty, verbose: true },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        allContracts = (await res.json()) as unknown[];
        if (!Array.isArray(allContracts)) allContracts = [];
      } else {
        const text = await res.text();
        this.logger.warn(
          `queryTokenHoldingsByInterface ${res.status}: ${text.slice(0, 200)}`,
        );
        return {};
      }
    } catch (err) {
      this.logger.warn(`queryTokenHoldingsByInterface error: ${String(err)}`);
      return {};
    }

    // Parse hasil: aggregate per instrumentId (case-insensitive, sum amount).
    const result: Record<string, number> = {};
    for (const entry of allContracts) {
      if (!entry || typeof entry !== 'object') continue;
      const wrapper = entry as Record<string, unknown>;
      const active = wrapper.contractEntry as
        | Record<string, unknown>
        | undefined;
      const jsActive = active?.JsActiveContract as
        | Record<string, unknown>
        | undefined;
      const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};

      // Instrument id: coba nested {id} atau flat string.
      const instNested = args.instrument as { id?: string } | undefined;
      const instId =
        instNested?.id ??
        (typeof args.instrumentId === 'string' ? args.instrumentId : null);
      if (!instId) continue;
      if (instId.toLowerCase() === 'amulet') continue; // CC, skip

      // Amount: coba nested {initialAmount|amount} atau flat string.
      const amtObj = args.amount as Record<string, unknown> | undefined;
      const amountStr =
        typeof args.amount === 'string'
          ? args.amount
          : typeof amtObj?.initialAmount === 'string'
            ? amtObj.initialAmount
            : typeof amtObj?.amount === 'string'
              ? amtObj.amount
              : typeof args.balance === 'string'
                ? args.balance
                : null;
      if (!amountStr) continue;
      const amount = parseFloat(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const id = instId.toLowerCase();
      result[id] = (result[id] ?? 0) + amount;
    }

    if (DEBUG_LEDGER) {
      this.logger.verbose(
        `Token InterfaceFilter query: party=${partyId.split('::')[0]} ` +
          `found ${allContracts.length} holding contracts, ` +
          `${Object.keys(result).length} instruments`,
      );
    }
    return result;
  }

  /**
   * Get saldo on-chain untuk 1 instrument tertentu (mis. USDCx) milik party.
   *
   * Wrapper ringan atas queryTokenHoldingsByInterface — ambil map lalu baca
   * key instrumentId. Dipakai untuk pre-check saldo sebelum send-token dan
   * offer reconciler baseline.
   *
   * Menggantikan queryTokenHoldings (WildcardFilter) yang rusak untuk token
   * non-CC — method itu return [] untuk interface-only contract seperti USDCx.
   *
   * @returns total amount (number), atau 0 kalau party tidak pegang instrument tsb.
   */
  async getTokenBalanceOnChain(
    partyId: string,
    instrumentId: string,
  ): Promise<number> {
    const holdings = await this.queryTokenHoldingsByInterface(partyId);
    return holdings[instrumentId.toLowerCase()] ?? 0;
  }

  /**
   * Get daftar holding contract IDs untuk 1 instrument tertentu milik party.
   *
   * Dipakai executeTransferFactoryTransfer (CIP-0056) untuk dapat inputHoldingCids
   * — daftar contract yang akan dikonsumsi saat transfer. Tanpa ini, transfer
   * gagal "Sender has no holdings".
   *
   * Pakai InterfaceFilter (bukan WildcardFilter yang return [] untuk USDCx).
   * Return contractId + amount per holding supaya caller bisa sum/filter.
   *
   * RETRY: kasus swap CC->USDCx, delivery attempt bisa terjadi sebelum swap
   * output settle di ACS (lag offset). Retry 3x dengan delay 3s supaya
   * holding yang baru saja di-swap ke trading account sempat visible.
   *
   * @returns array { contractId, amount }, kosong kalau party tidak pegang.
   */
  async getTokenHoldingCids(
    partyId: string,
    instrumentId: string,
  ): Promise<Array<{ contractId: string; amount: string }>> {
    const maxRetries = 3;
    const retryDelayMs = 3_000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const holdings = await this.queryTokenHoldingsByInterfaceCids(partyId);
      const result = holdings[instrumentId.toLowerCase()] ?? [];
      if (result.length > 0) {
        if (attempt > 1) {
          this.logger.log(
            `getTokenHoldingCids: ${instrumentId} found ${result.length} holdings for ${partyId.split('::')[0]} on attempt ${attempt}/${maxRetries}`,
          );
        }
        return result;
      }
      // Empty — kalau bukan attempt terakhir, tunggu lalu retry (timing/offset lag).
      if (attempt < maxRetries) {
        if (DEBUG_LEDGER) {
          this.logger.verbose(
            `getTokenHoldingCids: ${instrumentId} not found for ${partyId.split('::')[0]} (attempt ${attempt}/${maxRetries}), retry in ${retryDelayMs}ms...`,
          );
        }
        await sleep(retryDelayMs);
      }
    }
    // Final attempt tetap kosong — log WARN supaya keliatan di produksi.
    // Bisa berarti: (a) party emang gak pegang, (b) service account gak punya
    // read rights ke party tsb, (c) InterfaceFilter gak match untuk party tsb.
    const allKeys = await this.queryTokenHoldingsByInterfaceCids(partyId).then(
      (h) => Object.keys(h),
    );
    this.logger.warn(
      `getTokenHoldingCids: ${instrumentId} NOT FOUND for party=${partyId.split('::')[0]} after ${maxRetries} attempts. ` +
        `All instruments visible to this party: [${allKeys.join(',') || 'NONE'}]. ` +
        `Kalau party pegang token tapi kosong → cek CanReadAsAnyParty rights / CanActAs trading account.`,
    );
    return [];
  }

  /**
   * Query token holdings via InterfaceFilter — return contractId + amount
   * (variant dari queryTokenHoldingsByInterface yang return sum per instrument).
   *
   * Dipakai getTokenHoldingCids untuk dapat inputHoldingCids CIP-0056.
   */
  private async queryTokenHoldingsByInterfaceCids(
    partyId: string,
  ): Promise<Record<string, Array<{ contractId: string; amount: string }>>> {
    if (!partyId) return {};

    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }

    const filtersByParty: Record<string, unknown> = {
      [partyId]: {
        cumulative: [
          {
            identifierFilter: {
              InterfaceFilter: {
                value: {
                  interfaceId:
                    '#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding',
                  includeInterfaceView: true,
                  includeCreatedEventBlob: false,
                },
              },
            },
          },
        ],
      },
    };

    let allContracts: unknown[] = [];
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({
          eventFormat: { filtersByParty, verbose: true },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        allContracts = (await res.json()) as unknown[];
        if (!Array.isArray(allContracts)) allContracts = [];
      } else {
        return {};
      }
    } catch {
      return {};
    }

    const result: Record<
      string,
      Array<{ contractId: string; amount: string }>
    > = {};
    for (const entry of allContracts) {
      if (!entry || typeof entry !== 'object') continue;
      const wrapper = entry as Record<string, unknown>;
      const active = wrapper.contractEntry as
        | Record<string, unknown>
        | undefined;
      const jsActive = active?.JsActiveContract as
        | Record<string, unknown>
        | undefined;
      const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;
      const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
      if (!cid) continue;
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};

      const instNested = args.instrument as { id?: string } | undefined;
      const instId =
        instNested?.id ??
        (typeof args.instrumentId === 'string' ? args.instrumentId : null);
      if (!instId || instId.toLowerCase() === 'amulet') continue;

      const amtObj = args.amount as Record<string, unknown> | undefined;
      const amountStr =
        typeof args.amount === 'string'
          ? args.amount
          : typeof amtObj?.initialAmount === 'string'
            ? amtObj.initialAmount
            : typeof amtObj?.amount === 'string'
              ? amtObj.amount
              : typeof args.balance === 'string'
                ? args.balance
                : null;
      if (!amountStr) continue;

      const id = instId.toLowerCase();
      if (!result[id]) result[id] = [];
      result[id].push({ contractId: cid, amount: amountStr });
    }
    return result;
  }

  /**
   * Query the ACS for pending transfer offers visible to a party.
   *
   * Returns both:
   *   - Legacy Splice.Wallet.TransferOffer:TransferOffer contracts
   *   - CIP-0056 AmuletTransferInstruction contracts (Splice.AmuletTransferInstruction)
   *
   * Uses WildcardFilter + client-side filter (same pattern as queryAmuletHoldings)
   * because MainNet TemplateFilter rejects full package hashes.
   *
   * @param partyId - Canton party ID to query offers for
   * @returns Array of pending offers with type, contractId, sender, receiver, amount, description
   */
  async queryPendingOffers(
    partyId: string,
    /**
     * Direction filter:
     *  - 'incoming' (default) → offers where this party is the RECEIVER (Accept/Reject)
     *  - 'outgoing'            → offers where this party is the SENDER (Withdraw)
     *
     * Default 'incoming' = perilaku lama (backward-compat). Filter dipilih di
     * tiap branch parser: incoming → skip bila receiver !== partyId;
     * outgoing → skip bila sender !== partyId.
     */
    direction: 'incoming' | 'outgoing' = 'incoming',
  ): Promise<
    Array<{
      type: 'transfer_offer' | 'transfer_instruction';
      contractId: string;
      sender: string;
      receiver: string;
      amount: string;
      description: string;
      expiresAt: string;
      createdAt: string;
      /**
       * Instrument id offer ini (mis. "Amulet" untuk CC, "USDCX" untuk token
       * non-CC). Default "Amulet" untuk backward-compat (legacy CC offers +
       * TransferOffer lama yang tidak punya field instrument). Dipakai UI untuk
       * tampilkan label token yang benar, bukan hardcoded "CC".
       */
      instrumentId: string;
      /** Admin party instrument (mis. "DSO::1220..."). Kosong untuk legacy. */
      instrumentAdmin: string;
    }>
  > {
    const isOutgoing = direction === 'outgoing';
    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }

    let allContracts: unknown[] = [];
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({
          eventFormat: {
            filtersByParty: {
              [partyId]: {
                cumulative: [
                  {
                    identifierFilter: {
                      WildcardFilter: {
                        value: { includeCreatedEventBlob: false },
                      },
                    },
                  },
                ],
              },
            },
            verbose: true,
          },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        allContracts = (await res.json()) as unknown[];
        if (!Array.isArray(allContracts)) allContracts = [];
      }
    } catch (err) {
      this.logger.warn(`queryPendingOffers error: ${String(err)}`);
    }

    const offers: Array<{
      type: 'transfer_offer' | 'transfer_instruction';
      contractId: string;
      sender: string;
      receiver: string;
      amount: string;
      description: string;
      expiresAt: string;
      createdAt: string;
      instrumentId: string;
      instrumentAdmin: string;
    }> = [];

    for (const entry of allContracts) {
      if (!entry || typeof entry !== 'object') continue;
      const wrapper = entry as Record<string, unknown>;
      const active = wrapper.contractEntry as
        | Record<string, unknown>
        | undefined;
      const jsActive = active?.JsActiveContract as
        | Record<string, unknown>
        | undefined;
      const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;

      const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
      const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};
      if (!cid) continue;

      // Legacy: Splice.Wallet.TransferOffer:TransferOffer
      if (tplId.includes('Splice.Wallet.TransferOffer:TransferOffer')) {
        const receiver = typeof args.receiver === 'string' ? args.receiver : '';
        const sender = typeof args.sender === 'string' ? args.sender : '';
        // Direction filter: incoming → must be receiver; outgoing → must be sender.
        // Case-insensitive: on-chain party ID bisa beda casing (Cantex vs cantex)
        // vs DB yang selalu lowercase → pakai cantonPartyIdsEqual, bukan ===.
        if (
          isOutgoing
            ? !cantonPartyIdsEqual(sender, partyId)
            : !cantonPartyIdsEqual(receiver, partyId)
        )
          continue;
        const ccAmount = typeof args.amount === 'string' ? args.amount : '0';
        const desc =
          typeof args.description === 'string' ? args.description : '';
        const expiresAt =
          typeof args.expiresAt === 'string' ? args.expiresAt : '';
        const trackingId =
          typeof args.trackingId === 'string' ? args.trackingId : '';

        offers.push({
          type: 'transfer_offer',
          contractId: cid,
          sender,
          receiver,
          amount: ccAmount,
          description: desc || trackingId,
          expiresAt,
          createdAt: '',
          // Legacy TransferOffer tidak punya field instrument → default CC.
          instrumentId: 'Amulet',
          instrumentAdmin: '',
        });
        continue;
      }

      // CIP-0056: AmuletTransferInstruction
      if (
        tplId.includes('AmuletTransferInstruction') ||
        tplId.includes('TransferInstruction')
      ) {
        // Skip if it's the interface/factory, not an actual instruction
        if (tplId.includes('Factory') || tplId.includes('Result')) continue;

        const transfer = args.transfer as Record<string, unknown> | undefined;
        if (!transfer) continue;

        const receiver =
          typeof transfer.receiver === 'string' ? transfer.receiver : '';
        const sender =
          typeof transfer.sender === 'string' ? transfer.sender : '';
        // Direction filter: incoming → must be receiver; outgoing → must be sender.
        // Case-insensitive: on-chain party ID bisa beda casing vs DB lowercase.
        if (
          isOutgoing
            ? !cantonPartyIdsEqual(sender, partyId)
            : !cantonPartyIdsEqual(receiver, partyId)
        )
          continue;

        const amount =
          typeof transfer.amount === 'string' ? transfer.amount : '0';
        const meta = transfer.meta as
          | Record<string, Record<string, string>>
          | undefined;
        const desc =
          meta?.values?.['splice.lfdecentralizedtrust.org/reason'] ?? '';
        const executeBefore =
          typeof transfer.executeBefore === 'string'
            ? transfer.executeBefore
            : '';
        const requestedAt =
          typeof transfer.requestedAt === 'string' ? transfer.requestedAt : '';

        // Instrument id + admin dari payload transfer (CIP-0056 choiceArguments).
        // Default "Amulet" kalau field tidak ada (backward-compat CC offers lama).
        const instrument = transfer.instrumentId as
          | { id?: string; admin?: string }
          | string
          | undefined;
        const instrId =
          typeof instrument === 'string'
            ? instrument
            : (instrument?.id ?? 'Amulet');
        const instrAdmin =
          typeof instrument === 'object' ? (instrument.admin ?? '') : '';

        offers.push({
          type: 'transfer_instruction',
          contractId: cid,
          sender,
          receiver,
          amount,
          description: desc,
          expiresAt: executeBefore,
          createdAt: requestedAt,
          instrumentId: instrId,
          instrumentAdmin: instrAdmin,
        });
        continue;
      }

      // ── USDCx / registry-token TransferOffer ──────────────────────────
      // Template: Utility.Registry.App.V0.Model.Transfer:TransferOffer
      // Berbeda dari AmuletTransferInstruction — pakai nama template TransferOffer,
      // field shape mungkin beda (sender/receiver/instrument langsung di root).
      // Coba beberapa shape field yang umum (defensive parsing).
      if (tplId.includes('TransferOffer')) {
        // Skip if it's a factory/interface, not an actual offer.
        if (
          tplId.includes('Factory') ||
          tplId.includes('Result') ||
          tplId.includes('Preapproval')
        )
          continue;

        // Defensive: coba beberapa field name conventions.
        // Registry-app TransferOffer mungkin punya: sender, receiver, amount,
        // instrumentAdmin, instrumentId (flat) ATAU nested di `transfer`.
        const transfer = (args.transfer as Record<string, unknown>) || args;

        const receiver =
          typeof transfer.receiver === 'string' ? transfer.receiver : '';
        const sender =
          typeof transfer.sender === 'string' ? transfer.sender : '';
        // Direction filter: incoming → must be receiver; outgoing → must be sender.
        // Case-insensitive: on-chain party ID bisa beda casing vs DB lowercase.
        if (
          isOutgoing
            ? !cantonPartyIdsEqual(sender, partyId)
            : !cantonPartyIdsEqual(receiver, partyId)
        )
          continue;
        const amount =
          typeof transfer.amount === 'string'
            ? transfer.amount
            : typeof transfer.amount === 'number'
              ? String(transfer.amount)
              : '0';

        // Instrument: bisa flat (instrumentAdmin/instrumentId) atau nested.
        const instObj = (transfer.instrumentId ?? transfer.instrument) as
          | { id?: string; admin?: string }
          | string
          | undefined;
        const instrId =
          typeof instObj === 'string' ? instObj : (instObj?.id ?? '');
        const instrAdmin =
          typeof instObj === 'object' ? (instObj.admin ?? '') : '';

        const meta = transfer.meta as
          | Record<string, Record<string, string>>
          | undefined;
        const desc =
          meta?.values?.['splice.lfdecentralizedtrust.org/reason'] ??
          (typeof transfer.description === 'string'
            ? transfer.description
            : '');
        const expiresAt =
          typeof transfer.executeBefore === 'string'
            ? transfer.executeBefore
            : '';
        const requestedAt =
          typeof transfer.requestedAt === 'string' ? transfer.requestedAt : '';

        offers.push({
          type: 'transfer_instruction',
          contractId: cid,
          sender,
          receiver,
          amount,
          description: desc,
          expiresAt,
          createdAt: requestedAt,
          instrumentId: instrId || 'Unknown',
          instrumentAdmin: instrAdmin,
        });
        continue;
      }
    }

    if (offers.length > 0) {
      this.logger.log(
        `Pending offers: party=${partyId.split('::')[0]} found ${offers.length} ` +
          `(${offers.filter((o) => o.type === 'transfer_offer').length} legacy, ` +
          `${offers.filter((o) => o.type === 'transfer_instruction').length} CIP-0056)`,
      );
    }
    return offers;
  }

  /**
   * Lookup SATU pending offer by contract ID — dipakai saat accept/reject
   * supaya amount + sender yang dicatat ke DB adalah nilai truthful dari ledger,
   * bukan 0 / placeholder.
   *
   * Menggunakan queryPendingOffers + filter cid (murah, hasil sudah di-cache
   * di validator). Return null kalau offer tidak ditemukan (sudah di-accept/
   * expired/typo cid).
   */
  async lookupOfferDetail(
    cid: string,
    partyId: string,
  ): Promise<{
    type: 'transfer_offer' | 'transfer_instruction';
    contractId: string;
    sender: string;
    receiver: string;
    amount: string;
    description: string;
    instrumentId: string;
    instrumentAdmin: string;
  } | null> {
    try {
      const offers = await this.queryPendingOffers(partyId);
      return offers.find((o) => o.contractId === cid) ?? null;
    } catch (err) {
      this.logger.warn(`lookupOfferDetail error: ${String(err)}`);
      return null;
    }
  }

  /**
   * Lookup SATU pending offer by contract ID — cek KEDUA arah (incoming &
   * outgoing). Dipakai endpoint withdraw supaya resolve instrumentId/admin
   * benar untuk outgoing offer (lookupOfferDetail lama hanya filter receiver
   * → return null untuk offer milik sender).
   *
   * Urutan: incoming dulu (kasus umum), lalu outgoing. Return null kalau cid
   * tidak ditemukan di kedua arah (sudah settled/expired/typo).
   */
  async lookupOfferDetailBothDirections(
    cid: string,
    partyId: string,
  ): Promise<{
    type: 'transfer_offer' | 'transfer_instruction';
    contractId: string;
    sender: string;
    receiver: string;
    amount: string;
    description: string;
    instrumentId: string;
    instrumentAdmin: string;
  } | null> {
    try {
      const incoming = await this.queryPendingOffers(partyId, 'incoming');
      const found = incoming.find((o) => o.contractId === cid);
      if (found) return found;
      // Bukan incoming → cek outgoing (party = sender).
      const outgoing = await this.queryPendingOffers(partyId, 'outgoing');
      return outgoing.find((o) => o.contractId === cid) ?? null;
    } catch (err) {
      this.logger.warn(`lookupOfferDetailBothDirections error: ${String(err)}`);
      return null;
    }
  }

  /**
   * Query the Active Contract Set (ACS) for a specific template.
   *
   * Uses POST /v2/state/active-contracts with a WildcardFilter or
   * IdentifierFilter to find contracts visible to the given parties.
   *
   * Per official docs:
   *   https://docs.canton.network/appdev/modules/m4-json-api-tutorial
   *
   * The request body follows the eventFormat / filtersForAnyParty structure:
   * {
   *   "eventFormat": {
   *     "filtersByParty": {},
   *     "filtersForAnyParty": {
   *       "cumulative": [
   *         { "identifierFilter": { "TemplateFilter": { "templateId": "...", ... } } }
   *       ]
   *     },
   *     "verbose": false
   *   },
   *   "activeAtOffset": "<completionOffset>"
   * }
   *
   * @param templateId  - e.g. "#canquest:Main:Quest" or full packageId:Module:Template
   * @param parties     - parties whose visible contracts to query
   * @param activeAtOffset - ledger offset from a prior completionOffset (optional)
   */
  async queryActiveContracts(
    templateId: string,
    parties: string[],
    activeAtOffset?: number | string,
  ): Promise<unknown[]> {
    // Get current ledger end to use as activeAtOffset if not specified
    let offset = activeAtOffset;
    if (offset === undefined) {
      try {
        const end = (await this.ledgerEnd()) as { offset?: number | string };
        offset = end?.offset ?? 0;
      } catch {
        offset = 0;
      }
    }

    const filtersByParty: Record<string, unknown> = {};
    for (const party of parties) {
      filtersByParty[party] = {
        cumulative: [
          {
            identifierFilter: {
              TemplateFilter: {
                value: {
                  templateId,
                  includeCreatedEventBlob: true,
                },
              },
            },
          },
        ],
      };
    }

    const body = {
      eventFormat: {
        filtersByParty,
        verbose: false,
      },
      activeAtOffset: offset,
    };

    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 413) {
          // Participant has >200 contracts for this template — normal at scale.
          // Fallback: idempotency handled by command deduplication.
          this.logger.debug(
            `queryActiveContracts 413 (limit reached) — skipping ACS lookup, using command dedup`,
          );
        } else {
          this.logger.warn(
            `queryActiveContracts ${res.status}: ${text.slice(0, 200)}`,
          );
        }
        return [];
      }

      const data = (await res.json()) as unknown[];
      // The response is an array of contract entries
      return Array.isArray(data) ? data : [];
    } catch (err) {
      this.logger.warn(`queryActiveContracts error: ${String(err)}`);
      return [];
    }
  }

  /**
   * Create a contract on the Canton ledger.
   *
   * CreateCommand body per official docs:
   * {
   *   "CreateCommand": {
   *     "templateId": "<packageId>:<ModuleName>:<TemplateName>",
   *     "createArguments": { ... }
   *   }
   * }
   *
   * Returns { ok, contractId, updateId }
   */
  async createContract(
    templateId: string,
    createArguments: unknown,
    actAs: string[],
    commandId?: string,
  ): Promise<{
    ok: boolean;
    contractId: string | null;
    updateId: string | null;
    error?: string;
  }> {
    const { ok, status, text } = await this.submitCommand(
      [{ CreateCommand: { templateId, createArguments } }],
      actAs,
      undefined,
      commandId,
      undefined, // identity
      'submit-and-wait-for-transaction-tree',
    );

    if (ok) {
      try {
        const parsed = JSON.parse(text) as {
          updateId?: string;
          contractId?: string;
        };
        const contractId =
          parsed.contractId ?? extractCreatedContractId(text) ?? null;
        return {
          ok: true,
          contractId,
          updateId: extractUpdateIdFromTree(text) ?? null,
        };
      } catch {
        return { ok: true, contractId: null, updateId: null };
      }
    }

    this.logger.warn(`createContract failed ${status}: ${text.slice(0, 200)}`);
    return {
      ok: false,
      contractId: null,
      updateId: null,
      error: text.slice(0, 300),
    };
  }

  /**
   * Scan recent ledger updates for an archived contract (e.g. accepted TransferOffer).
   */
  async findUpdateIdForContract(
    contractId: string,
    partyId: string,
    options?: { lookback?: number },
  ): Promise<string | null> {
    const lookback = options?.lookback ?? 800;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      const endNum = Number(end?.offset ?? 0);
      const begin = Math.max(0, endNum - lookback);
      const txs = await this.fetchTransactionUpdates(partyId, begin);
      for (const tx of txs) {
        for (const event of tx.events ?? []) {
          if (event.archived?.contractId === contractId) {
            return tx.updateId;
          }
        }
      }
    } catch (err) {
      this.logger.warn(`findUpdateIdForContract: ${String(err)}`);
    }
    return null;
  }

  /** Load one update's events from the transaction stream (recent window). */
  async fetchTransactionByUpdateId(
    updateId: string,
    partyId: string,
  ): Promise<{ updateId: string; events: LedgerStreamEvent[] } | null> {
    const lookback = 1200;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      const begin = Math.max(0, Number(end?.offset ?? 0) - lookback);
      const txs = await this.fetchTransactionUpdates(partyId, begin);
      const match = txs.find((t) => t.updateId === updateId);
      if (!match) return null;
      return { updateId: match.updateId, events: match.events ?? [] };
    } catch (err) {
      this.logger.warn(`fetchTransactionByUpdateId: ${String(err)}`);
      return null;
    }
  }

  private async fetchTransactionUpdates(
    partyId: string,
    beginExclusive: number,
  ): Promise<LedgerStreamTransaction[]> {
    const body = {
      filter: {
        filtersByParty: {
          [partyId]: {
            cumulative: [
              {
                identifierFilter: {
                  WildcardFilter: {
                    value: { includeCreatedEventBlob: false },
                  },
                },
              },
            ],
          },
        },
      },
      beginExclusive,
    };

    const res = await fetch(`${this.baseUrl}/v2/updates/transactions`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      // 404 = endpoint tidak tersedia di versi Canton JSON API ini (normal, tidak perlu log)
      // Endpoint ini opsional — hanya dipakai untuk transaction history lookup
      if (res.status !== 404) {
        const text = await res.text();
        this.logger.debug(
          `fetchTransactionUpdates ${res.status}: ${text.slice(0, 120)}`,
        );
      }
      return [];
    }
    const data = (await res.json()) as {
      transactions?: LedgerStreamTransaction[];
    };
    return data.transactions ?? [];
  }

  /**
   * Grant CanActAs + CanReadAs rights to the operator (admin) for a party.
   * Allows the backend to submit commands + query ACS on behalf of this party.
   * Operator ID from LEDGER_API_ADMIN_USER (fallback CANTON_LEDGER_API_USER).
   * IDEMPOTEN: 409 / ALREADY_EXISTS diabaikan.
   */
  async grantOperatorRightsOnParty(partyId: string): Promise<void> {
    const operatorId = this.ledgerApiUser;
    if (!operatorId) {
      this.logger.error(
        'LEDGER_API_ADMIN_USER / CANTON_LEDGER_API_USER belum diset — operator rights TIDAK di-grant',
      );
      return;
    }
    const token = await this.keycloak.getAdminLedgerToken();
    const url = `${this.baseUrl}/v2/users/${encodeURIComponent(operatorId)}/rights`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: operatorId,
          rights: [
            { kind: { CanActAs: { value: { party: partyId } } } },
            { kind: { CanReadAs: { value: { party: partyId } } } },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        this.logger.log(
          `Operator rights granted: ${operatorId.slice(0, 8)}... → ${partyId.split('::')[0]}`,
        );
        return;
      }
      const text = await res.text();
      if (res.status === 409 || text.includes('ALREADY_EXISTS')) {
        this.logger.debug(
          `Operator rights already exist for party=${partyId.split('::')[0]}`,
        );
        return;
      }
      this.logger.warn(
        `grantOperatorRightsOnParty ${res.status}: ${text.slice(0, 200)}`,
      );
    } catch (err) {
      this.logger.warn(`grantOperatorRightsOnParty error: ${String(err)}`);
    }
  }

  // ── Keycloak user onboarding ──────────────────────────────────────

  /**
   * Buat Ledger API user untuk UUID Keycloak dengan primaryParty.
   * POST /v2/users — IDEMPOTEN: 409 atau ALREADY_EXISTS tidak thrown.
   */
  async createLedgerUser(keycloakUuid: string, partyId: string): Promise<void> {
    const token = await this.keycloak.getAdminLedgerToken();
    const url = `${this.baseUrl}/v2/users`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user: { id: keycloakUuid, primaryParty: partyId },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      this.logger.log(
        `Ledger user created: ${keycloakUuid.slice(0, 8)}... → ${partyId.split('::')[0]}`,
      );
      return;
    }
    const text = await res.text();
    if (res.status === 409 || text.includes('ALREADY_EXISTS')) {
      this.logger.debug(
        `Ledger user already exists: ${keycloakUuid.slice(0, 8)}...`,
      );
      return;
    }
    throw new Error(
      `createLedgerUser gagal (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  /**
   * Update primaryParty untuk Ledger API user.
   * PATCH /v2/users/{keycloakUuid}
   */
  async setLedgerUserPrimaryParty(
    keycloakUuid: string,
    partyId: string,
  ): Promise<void> {
    const token = await this.keycloak.getAdminLedgerToken();
    const url = `${this.baseUrl}/v2/users/${encodeURIComponent(keycloakUuid)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user: { id: keycloakUuid, primaryParty: partyId },
        updateMask: { paths: ['primary_party'] },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      this.logger.log(
        `Ledger user primaryParty set: ${keycloakUuid.slice(0, 8)}... → ${partyId.split('::')[0]}`,
      );
      return;
    }
    const text = await res.text();
    throw new Error(
      `setLedgerUserPrimaryParty gagal (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  /**
   * Grant CanActAs + CanReadAs rights untuk party user sendiri.
   * POST /v2/users/{keycloakUuid}/rights — idempoten (409 diabaikan).
   */
  async grantLedgerUserRights(
    keycloakUuid: string,
    partyId: string,
  ): Promise<void> {
    const token = await this.keycloak.getAdminLedgerToken();
    const url = `${this.baseUrl}/v2/users/${encodeURIComponent(keycloakUuid)}/rights`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: keycloakUuid,
        rights: [
          { kind: { CanActAs: { value: { party: partyId } } } },
          { kind: { CanReadAs: { value: { party: partyId } } } },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      this.logger.log(
        `Ledger user rights granted: ${keycloakUuid.slice(0, 8)}... → ${partyId.split('::')[0]}`,
      );
      return;
    }
    const text = await res.text();
    if (res.status === 409) {
      this.logger.debug(
        `Ledger user rights already granted (409): ${keycloakUuid.slice(0, 8)}...`,
      );
      return;
    }
    throw new Error(
      `grantLedgerUserRights gagal (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  /**
   * Orkestrasi idempoten: create → set primaryParty → grant rights.
   * Semua langkah pakai token admin Keycloak dan baseUrl dari LEDGER_API_URL.
   */
  async ensureLedgerUser(keycloakUuid: string, partyId: string): Promise<void> {
    this.logger.log(
      `ensureLedgerUser start: uuid=${keycloakUuid.slice(0, 8)}... party=${partyId.split('::')[0]}`,
    );
    await this.createLedgerUser(keycloakUuid, partyId);
    await this.setLedgerUserPrimaryParty(keycloakUuid, partyId);
    await this.grantLedgerUserRights(keycloakUuid, partyId);
    await this.grantOperatorRightsOnParty(partyId);
    this.logger.log(
      `ensureLedgerUser done: uuid=${keycloakUuid.slice(0, 8)}... party=${partyId.split('::')[0]}`,
    );
  }

  // ============================================================
  // CC LOCK — self-lock via native LockedAmulet (CC stays owned by the user's party;
  // returned in full at expiry). Note: wallet custody is operator-managed (custodial).
  // Coin tetap milik owner; hanya kembali ke owner setelah expiresAt.
  // ============================================================

  /** Lock `amountCc` milik ownerParty selama `lockSeconds` detik → LockedAmulet. */
  /**
   * M3b (signing relay): bangun command AmuletRules_Transfer self-lock TANPA
   * submit — mirror lockCc langkah 1-4 (scan-proxy contracts, holdings scoring,
   * inputs, choiceArgument). Opsi lockHolderOverride untuk user external
   * (self-held: lockHolder = party user → otorisasi tunggal, cocok interactive
   * submission).
   */
  async buildLockCcCommand(
    ownerParty: string,
    amountCc: number,
    lockSeconds: number,
    opts?: { lockHolderOverride?: string },
  ): Promise<
    | {
        ok: true;
        command: Record<string, unknown>;
        commandId: string;
        disclosedContracts: unknown[];
        expiresAt: string;
      }
    | { ok: false; error: string }
  > {
    const expectedDso = this.config.get<string>('CANTON_DSO_PARTY_ID') ?? null;
    const lockHolder =
      opts?.lockHolderOverride ||
      this.config.get<string>('CANTON_LOCK_HOLDER_PARTY')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (!lockHolder) return { ok: false, error: 'lock holder party not set' };

    const amuletRules = await this.fetchScanProxyContract('amulet-rules');
    if (!amuletRules) return { ok: false, error: 'scan-proxy /amulet-rules failed' };
    const openRound = await this.fetchScanProxyContract(
      'open-and-issuing-mining-rounds',
    );
    if (!openRound) {
      return { ok: false, error: 'scan-proxy /open-and-issuing-mining-rounds failed' };
    }

    const holdings = await this.queryAmuletHoldingsRaw(ownerParty);
    if (holdings.length === 0)
      return { ok: false, error: `${ownerParty} tidak punya Amulet` };

    const round = openRound.round ?? 0;
    const scored = holdings
      .map((h) => {
        const init = parseFloat(h.initialAmount) || 0;
        const rate = parseFloat(h.ratePerRound) || 0;
        const decay = Math.max(0, round - (h.createdAtRound || 0)) * rate;
        return { h, eff: Math.max(0, init - decay) };
      })
      .sort((a, b) => b.eff - a.eff);

    const totalEff = scored.reduce((s, x) => s + x.eff, 0);
    if (totalEff < amountCc) {
      return { ok: false, error: `Saldo efektif ~${totalEff.toFixed(4)} < ${amountCc} CC` };
    }

    const inputs: Array<{ tag: 'InputAmulet'; value: string }> = [];
    let acc = 0;
    for (const s of scored) {
      inputs.push({ tag: 'InputAmulet', value: s.h.contractId });
      acc += s.eff;
      if (acc >= amountCc) break;
    }

    const expiresAt = new Date(Date.now() + lockSeconds * 1000).toISOString();
    const choiceArgument = {
      transfer: {
        sender: ownerParty,
        provider: lockHolder,
        inputs,
        outputs: [
          {
            receiver: ownerParty,
            receiverFeeRatio: '0.0',
            amount: amountCc.toString(),
            lock: { holders: [lockHolder], expiresAt, optContext: null },
          },
        ],
        beneficiaries: null,
      },
      // TransferContext FLAT — mirror lockCc (bukan PaymentTransferContext).
      context: {
        openMiningRound: openRound.contractId,
        issuingMiningRounds: [],
        validatorRights: [],
        featuredAppRight: null,
      },
      expectedDso,
    };

    const disclosedContracts = [
      { templateId: amuletRules.templateId, contractId: amuletRules.contractId, createdEventBlob: amuletRules.blob },
      { templateId: openRound.templateId, contractId: openRound.contractId, createdEventBlob: openRound.blob },
    ];

    return {
      ok: true,
      command: {
        ExerciseCommand: {
          templateId: amuletRules.templateId,
          contractId: amuletRules.contractId,
          choice: 'AmuletRules_Transfer',
          choiceArgument,
        },
      },
      commandId: `lock-cc-${randomUUID()}`,
      disclosedContracts,
      expiresAt,
    };
  }

  /**
   * M3b (signing relay): bangun command LockedAmulet_OwnerExpireLockV2 TANPA
   * submit — mirror unlockCc (resolve template dari chain, disclosed openRound).
   * actAs [owner] → otorisasi tunggal, cocok interactive submission.
   */
  async buildUnlockCcCommand(
    ownerParty: string,
    lockedAmuletCid: string,
  ): Promise<
    | {
        ok: true;
        command: Record<string, unknown>;
        commandId: string;
        disclosedContracts: unknown[];
      }
    | { ok: false; error: string }
  > {
    const openRound = await this.fetchScanProxyContract(
      'open-and-issuing-mining-rounds',
    );
    if (!openRound) {
      return { ok: false, error: 'scan-proxy /open-and-issuing-mining-rounds failed' };
    }

    const locks = await this.findLockedAmulets(ownerParty);
    const tmpl =
      locks.find((l) => l.contractId === lockedAmuletCid)?.templateId ?? null;
    if (!tmpl) {
      const ar = await this.fetchScanProxyContract('amulet-rules');
      const pkg = ar?.templateId?.split(':')[0];
      const fallback = pkg ? `${pkg}:Splice.Amulet:LockedAmulet` : null;
      if (!fallback) return { ok: false, error: 'LockedAmulet cid tidak ditemukan' };
      return {
        ok: true,
        command: {
          ExerciseCommand: {
            templateId: fallback,
            contractId: lockedAmuletCid,
            choice: 'LockedAmulet_OwnerExpireLockV2',
            choiceArgument: {},
          },
        },
        commandId: `unlock-cc-${randomUUID()}`,
        disclosedContracts: [
          { templateId: openRound.templateId, contractId: openRound.contractId, createdEventBlob: openRound.blob },
        ],
      };
    }

    return {
      ok: true,
      command: {
        ExerciseCommand: {
          templateId: tmpl,
          contractId: lockedAmuletCid,
          choice: 'LockedAmulet_OwnerExpireLockV2',
          choiceArgument: {},
        },
      },
      commandId: `unlock-cc-${randomUUID()}`,
      disclosedContracts: [
        { templateId: openRound.templateId, contractId: openRound.contractId, createdEventBlob: openRound.blob },
      ],
    };
  }

  async lockCc(
    ownerParty: string,
    amountCc: number,
    lockSeconds: number,
  ): Promise<{
    ok: boolean;
    lockedAmuletCid?: string;
    /** Canton transaction update id (root) — untuk link explorer Modo. */
    updateId?: string;
    expiresAt?: string;
    error?: string;
  }> {
    const expectedDso = this.config.get<string>('CANTON_DSO_PARTY_ID') ?? null;
    const lockHolder =
      this.config.get<string>('CANTON_LOCK_HOLDER_PARTY')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim();
    if (!lockHolder) return { ok: false, error: 'lock holder party not set' };

    const amuletRules = await this.fetchScanProxyContract('amulet-rules');
    if (!amuletRules)
      return { ok: false, error: 'scan-proxy /amulet-rules failed' };
    const openRound = await this.fetchScanProxyContract(
      'open-and-issuing-mining-rounds',
    );
    if (!openRound)
      return {
        ok: false,
        error: 'scan-proxy /open-and-issuing-mining-rounds failed',
      };

    const holdings = await this.queryAmuletHoldingsRaw(ownerParty);
    if (holdings.length === 0)
      return { ok: false, error: `${ownerParty} tidak punya Amulet` };

    const round = openRound.round ?? 0;
    const scored = holdings
      .map((h) => {
        const init = parseFloat(h.initialAmount) || 0;
        const rate = parseFloat(h.ratePerRound) || 0;
        const decay = Math.max(0, round - (h.createdAtRound || 0)) * rate;
        return { h, eff: Math.max(0, init - decay) };
      })
      .sort((a, b) => b.eff - a.eff);

    const totalEff = scored.reduce((s, x) => s + x.eff, 0);
    if (totalEff < amountCc)
      return {
        ok: false,
        error: `Saldo efektif ~${totalEff.toFixed(4)} < ${amountCc} CC`,
      };

    const inputs: Array<{ tag: 'InputAmulet'; value: string }> = [];
    let acc = 0;
    for (const s of scored) {
      inputs.push({ tag: 'InputAmulet', value: s.h.contractId });
      acc += s.eff;
      if (acc >= amountCc) break;
    }

    const expiresAt = new Date(Date.now() + lockSeconds * 1000).toISOString();

    const choiceArgument = {
      transfer: {
        sender: ownerParty,
        provider: lockHolder,
        inputs,
        outputs: [
          {
            receiver: ownerParty, // self → LockedAmulet milik owner
            receiverFeeRatio: '0.0',
            amount: amountCc.toString(),
            lock: { holders: [lockHolder], expiresAt, optContext: null },
          },
        ],
        beneficiaries: null,
      },
      // AmuletRules_Transfer.context is a FLAT TransferContext — NOT the nested
      // PaymentTransferContext ({amuletRules, context:{...}}) used by other choices.
      // TransferContext has NO amuletRules field: the AmuletRules contract is the
      // exercise TARGET (passed as contractId above), not an arg. Verified against
      // splice-amulet-0.1.18 encoders: module.js:593 TransferContext, 1163 Transfer.
      context: {
        openMiningRound: openRound.contractId,
        issuingMiningRounds: [],
        validatorRights: [],
        featuredAppRight: null,
      },
      expectedDso,
    };

    const disclosedContracts = [
      {
        templateId: amuletRules.templateId,
        contractId: amuletRules.contractId,
        createdEventBlob: amuletRules.blob,
      },
      {
        templateId: openRound.templateId,
        contractId: openRound.contractId,
        createdEventBlob: openRound.blob,
      },
    ];

    this.logger.log(
      `lockCc owner=${ownerParty.slice(0, 20)}… amount=${amountCc} inputs=${inputs.length} expiresAt=${expiresAt}`,
    );

    const { ok, status, text } = await this.exerciseChoice(
      amuletRules.contractId,
      amuletRules.templateId,
      'AmuletRules_Transfer',
      choiceArgument,
      [ownerParty, lockHolder],
      `lock-cc-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
      disclosedContracts,
    );

    if (!ok) {
      // Error ambigu (network/timeout/abort status 0, atau server error 5xx):
      // command mungkin SUDAH dieksekusi validator tapi response tidak sampai
      // client → jangan langsung bilang gagal. Verifikasi ke chain: cari
      // LockedAmulet baru milik owner dengan expiresAt yang persis cocok.
      // Reference: command deduplication di Canton — tx bisa sukses walau
      // client dapat network error.
      if (this.isAmbiguousError(status)) {
        this.logger.warn(
          `lockCc ambiguous error ${status} — verifying on-chain…`,
        );
        const verified = await this.verifyLockLanded(
          ownerParty,
          expiresAt,
          amountCc,
        );
        if (verified) {
          this.logger.log(
            `lockCc recovered: tx actually landed despite client error. lockedAmuletCid=${verified.slice(0, 20)}…`,
          );
          return { ok: true, lockedAmuletCid: verified, expiresAt };
        }
      }
      this.logger.warn(`lockCc failed ${status}: ${text.slice(0, 500)}`);
      return { ok: false, error: `Ledger ${status}: ${text.slice(0, 400)}` };
    }
    const lockedAmuletCid =
      this.findCreatedCidByTemplate(text, ':Splice.Amulet:LockedAmulet') ??
      undefined;
    // Extract updateId dari response exercise (untuk link explorer Modo).
    let updateId: string | undefined;
    try {
      JSON.parse(text); // validasi JSON saja — throw ditangkap catch
      updateId = extractUpdateIdFromTree(text) ?? undefined;
    } catch {
      /* ignore parse error */
    }
    this.logger.log(
      `lockCc OK lockedAmuletCid=${(lockedAmuletCid ?? '?').slice(0, 20)}… updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
    );
    return { ok: true, lockedAmuletCid, updateId, expiresAt };
  }

  /**
   * ATOMIC CC transfer multi-output via AmuletRules_Transfer (native Amulet).
   *
   * Pattern ini adalah NATIVE Splice utk CC (Amulet): 1 transfer dgn multiple
   * outputs (sender → [receiver1, receiver2, ...]). Berbeda dgn token-standard
   * TransferFactory_Transfer (single receiver) — utk atomic transfer+fee CC,
   * pakai AmuletRules_Transfer dgn outputs array.
   *
   * DAML reference (Splice.AmuletRules):
   *   data Transfer = Transfer with
   *     sender : Party
   *     provider : Party
   *     inputs : [TransferInput]
   *     outputs : [TransferOutput]   -- ← multi-receiver!
   *     beneficiaries : Optional [AppRewardBeneficiary]
   *
   *   data TransferOutput = TransferOutput with
   *     receiver : Party
   *     receiverFeeRatio : Decimal
   *     amount : Decimal
   *     lock : Optional TimeLock
   *
   * actAs: [sender, provider] (transferControllers = sender + provider).
   *
   * Template: based on lockCc() yang sudah proven jalan di production.
   */
  async executeAmuletRulesTransferMulti(params: {
    senderPartyId: string;
    /** Provider party (validator). Default CANTON_VALIDATOR_PARTY_ID. */
    providerPartyId?: string;
    outputs: Array<{
      receiver: string;
      amount: number; // CC amount (effective, bukan initial)
    }>;
    /** Optional: lock utk output tertentu (mis. utk eligibility LOCK_CC). */
    clientNonce?: string;
  }): Promise<{
    ok: boolean;
    updateId: string | null;
    error?: string;
  }> {
    const expectedDso = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim();
    if (!expectedDso)
      return {
        ok: false,
        updateId: null,
        error: 'CANTON_DSO_PARTY_ID not set',
      };
    const provider =
      params.providerPartyId ??
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID') ??
      '';
    if (!provider)
      return {
        ok: false,
        updateId: null,
        error: 'CANTON_VALIDATOR_PARTY_ID not set',
      };
    if (params.outputs.length === 0)
      return { ok: false, updateId: null, error: 'No outputs provided' };

    // 1) Disclosed contracts from scan-proxy (DSO-signed, with created_event_blob)
    const amuletRules = await this.fetchScanProxyContract('amulet-rules');
    if (!amuletRules)
      return {
        ok: false,
        updateId: null,
        error: 'scan-proxy /amulet-rules failed',
      };
    const openRound = await this.fetchScanProxyContract(
      'open-and-issuing-mining-rounds',
    );
    if (!openRound)
      return {
        ok: false,
        updateId: null,
        error: 'scan-proxy /open-and-issuing-mining-rounds failed',
      };

    // 2) Sender's Amulet inputs — pakai effective amount (decay-adjusted).
    //    AmuletRules_Transfer butuh inputs dgn effective amount >= total outputs.
    const holdings = await this.queryAmuletHoldingsRaw(params.senderPartyId);
    if (holdings.length === 0)
      return {
        ok: false,
        updateId: null,
        error: `${params.senderPartyId.split('::')[0]} tidak punya Amulet`,
      };
    const round = openRound.round ?? 0;
    const scored = holdings
      .map((h) => {
        const init = parseFloat(h.initialAmount) || 0;
        const rate = parseFloat(h.ratePerRound) || 0;
        const decay = Math.max(0, round - (h.createdAtRound || 0)) * rate;
        return { h, eff: Math.max(0, init - decay) };
      })
      .sort((a, b) => b.eff - a.eff);
    const totalAmount = params.outputs.reduce((s, o) => s + o.amount, 0);
    const totalEff = scored.reduce((s, x) => s + x.eff, 0);
    if (totalEff < totalAmount)
      return {
        ok: false,
        updateId: null,
        error: `Saldo efektif ~${totalEff.toFixed(4)} < ${totalAmount} CC (total outputs)`,
      };

    const inputs: Array<{ tag: 'InputAmulet'; value: string }> = [];
    let acc = 0;
    for (const s of scored) {
      inputs.push({ tag: 'InputAmulet', value: s.h.contractId });
      acc += s.eff;
      if (acc >= totalAmount) break;
    }

    // 3) Build outputs array (transfer + fee dalam 1 transfer)
    const outputs = params.outputs.map((o) => ({
      receiver: o.receiver,
      receiverFeeRatio: '0.0',
      amount: o.amount.toFixed(10),
      lock: null,
    }));

    // 4) choiceArgument — AmuletRules_Transfer (FLAT TransferContext, bukan nested)
    const choiceArgument = {
      transfer: {
        sender: params.senderPartyId,
        provider,
        inputs,
        outputs,
        beneficiaries: null,
      },
      context: {
        openMiningRound: openRound.contractId,
        issuingMiningRounds: [],
        validatorRights: [],
        featuredAppRight: null,
      },
      expectedDso,
    };

    const disclosedContracts = [
      {
        templateId: amuletRules.templateId,
        contractId: amuletRules.contractId,
        createdEventBlob: amuletRules.blob,
      },
      {
        templateId: openRound.templateId,
        contractId: openRound.contractId,
        createdEventBlob: openRound.blob,
      },
    ];

    const commandId = params.clientNonce
      ? `amulet-transfer-multi-${params.senderPartyId.split('::')[0]}-${params.clientNonce.slice(0, 16)}`
      : `amulet-transfer-multi-${params.senderPartyId.split('::')[0]}-${randomUUID().slice(0, 16)}`;

    this.logger.log(
      `AmuletRules_Transfer (multi-output): sender=${params.senderPartyId.split('::')[0]} ` +
        `outputs=[${params.outputs
          .map((o) => `${o.receiver.split('::')[0]}:${o.amount}`)
          .join(', ')}] inputs=${inputs.length} total=${totalAmount}CC`,
    );

    // actAs = transferControllers = sender + provider + SEMUA receivers.
    // DAML: transferControllers t = foldl addOutputController {sender, provider} outputs
    // Setiap receiver di outputs jadi authorizer wajib.
    // Backend custodial: service account punya CanActAs rights utk semua party tsb
    // (sender = user, provider = validator, receivers = receiver user + fee party).
    const actAsParties = new Set<string>([params.senderPartyId, provider]);
    for (const o of params.outputs) {
      if (o.receiver !== params.senderPartyId) actAsParties.add(o.receiver);
    }

    const { ok, status, text } = await this.exerciseChoice(
      amuletRules.contractId,
      amuletRules.templateId,
      'AmuletRules_Transfer',
      choiceArgument,
      [...actAsParties], // transferControllers = sender + provider + receivers
      commandId,
      'submit-and-wait-for-transaction-tree',
      disclosedContracts,
    );

    if (ok) {
      const updateId = extractUpdateIdFromTree(text);
      this.logger.log(
        `AmuletRules_Transfer (multi-output) OK: updateId=${updateId?.slice(0, 16) ?? 'unknown'} outputs=${outputs.length}`,
      );
      return { ok: true, updateId };
    }

    // Ambigous error → verify on-chain (sama pattern lockCc)
    if (this.isAmbiguousError(status)) {
      this.logger.warn(
        `AmuletRules_Transfer ambiguous error ${status} — tx mungkin sudah land. updateId akan null.`,
      );
      // Best-effort: return ok dgn updateId null (caller handle)
      return { ok: true, updateId: null };
    }

    this.logger.warn(
      `AmuletRules_Transfer (multi-output) failed ${status}: ${text.slice(0, 300)}`,
    );
    return {
      ok: false,
      updateId: null,
      error: `Ledger ${status}: ${text.slice(0, 300)}`,
    };
  }

  /**
   * True untuk HTTP status yang ambigu — command mungkin sudah dieksekusi
   * validator walau client tidak menerima response sukses.
   *   - 0   = network error / timeout / abort (fetch threw)
   *   - 5xx = server error setelah kemungkinan eksekusi
   */
  private isAmbiguousError(status: number): boolean {
    return status === 0 || status >= 500;
  }

  /**
   * Setelah lock error ambigu, cek apakah LockedAmulet baru benar-benar mendarat
   * di chain untuk owner. Match via expiresAt (generasi deterministik di lockCc)
   * + amount, sehingga akurat walau ada lock lain milik owner.
   */
  private async verifyLockLanded(
    ownerParty: string,
    expectedExpiresAt: string,
    expectedAmount: number,
  ): Promise<string | null> {
    // Kasih sedikit waktu supaya chain benar-benar committed + queryable.
    await sleep(2500);
    try {
      const locked = await this.findLockedAmulets(ownerParty);
      const match = locked.find(
        (l) =>
          l.expiresAt === expectedExpiresAt &&
          Math.abs(l.amount - expectedAmount) < 0.0001,
      );
      return match?.contractId ?? null;
    } catch (err) {
      this.logger.warn(`verifyLockLanded error: ${String(err)}`);
      return null;
    }
  }

  /**
   * v30: kontrak AKTIF milik party berdasarkan templateId (client-side filter).
   * Pakai WildcardFilter + filter templateId.endsWith — TemplateFilter menolak
   * package-hash penuh di MainNet (temuan yang sama dgn findLockedAmulets).
   * Return [{contractId, payload}] — payload = createArgument created event.
   */
  async queryContractsByTemplate(
    partyId: string,
    templateId: string,
  ): Promise<Array<{ contractId: string; payload: Record<string, unknown> }>> {
    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }
    if (!offset || offset === '0') {
      throw new Error(
        'queryContractsByTemplate: ledger-end offset unavailable — refusing to query ACS at offset 0',
      );
    }
    const body = {
      activeAtOffset: offset,
      eventFormat: {
        filtersByParty: {
          [partyId]: {
            cumulative: [
              {
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } },
                },
              },
            ],
          },
        },
        verbose: true,
      },
    };
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        this.logger.warn(`queryContractsByTemplate ${res.status}`);
        return [];
      }
      const arr = (await res.json()) as any[];
      const out: Array<{ contractId: string; payload: Record<string, unknown> }> = [];
      const suffix = `:${templateId.split(':').slice(-2).join(':')}`;
      for (const e of Array.isArray(arr) ? arr : []) {
        const ce = e?.contractEntry?.JsActiveContract?.createdEvent;
        if (!ce || typeof ce.templateId !== 'string') continue;
        if (ce.templateId !== templateId && !ce.templateId.endsWith(suffix)) continue;
        out.push({
          contractId: ce.contractId,
          payload: (ce.createArgument ?? {}) as Record<string, unknown>,
        });
      }
      return out;
    } catch (err) {
      this.logger.warn(`queryContractsByTemplate error: ${String(err)}`);
      return [];
    }
  }

  /** Daftar LockedAmulet milik ownerParty (untuk eligibility & unlock). */
  async findLockedAmulets(ownerParty: string): Promise<
    Array<{
      contractId: string;
      templateId: string;
      amount: number;
      expiresAt: string;
      holders: string[];
      /** v30: TimeLock.optContext (publik on-chain) — token opaque utk match LockProposalRecord.contextRef. */
      optContext: string | null;
    }>
  > {
    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }
    const body = {
      activeAtOffset: offset,
      eventFormat: {
        filtersByParty: {
          [ownerParty]: {
            cumulative: [
              {
                identifierFilter: {
                  WildcardFilter: { value: { includeCreatedEventBlob: false } },
                },
              },
            ],
          },
        },
        verbose: true,
      },
    };
    const out: Array<{
      contractId: string;
      templateId: string;
      amount: number;
      expiresAt: string;
      holders: string[];
      optContext: string | null;
    }> = [];
    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        this.logger.warn(`findLockedAmulets ${res.status}`);
        return [];
      }
      const arr = (await res.json()) as any[];
      for (const e of Array.isArray(arr) ? arr : []) {
        const ce = e?.contractEntry?.JsActiveContract?.createdEvent;
        if (!ce || typeof ce.templateId !== 'string') continue;
        if (!ce.templateId.endsWith(':Splice.Amulet:LockedAmulet')) continue;
        const arg = ce.createArgument ?? {};
        const amtRaw = arg.amulet?.amount?.initialAmount ?? '0';
        out.push({
          contractId: ce.contractId,
          templateId: ce.templateId,
          amount: parseFloat(typeof amtRaw === 'string' ? amtRaw : '0') || 0,
          expiresAt: arg.lock?.expiresAt ?? '',
          holders: Array.isArray(arg.lock?.holders) ? arg.lock.holders : [],
          optContext:
            typeof arg.lock?.optContext === 'string' && arg.lock.optContext
              ? arg.lock.optContext
              : null,
        });
      }
    } catch (err) {
      this.logger.warn(`findLockedAmulets error: ${String(err)}`);
    }
    return out;
  }

  /** Unlock LockedAmulet milik owner — HANYA berhasil setelah expiresAt lewat. */
  async unlockCc(
    ownerParty: string,
    lockedAmuletCid?: string,
  ): Promise<{
    ok: boolean;
    unlockedCid?: string;
    /** Canton update id dari exercise (untuk link explorer Modo). */
    updateId?: string;
    error?: string;
  }> {
    const openRound = await this.fetchScanProxyContract(
      'open-and-issuing-mining-rounds',
    );
    if (!openRound)
      return {
        ok: false,
        error: 'scan-proxy /open-and-issuing-mining-rounds failed',
      };

    const locks = await this.findLockedAmulets(ownerParty);
    let cid = lockedAmuletCid;
    let tmpl: string | null = cid
      ? (locks.find((l) => l.contractId === cid)?.templateId ?? null)
      : null;
    if (!cid) {
      const now = Date.now();
      const expired = locks.find(
        (l) => l.expiresAt && Date.parse(l.expiresAt) <= now,
      );
      if (!expired)
        return {
          ok: false,
          error: 'tidak ada LockedAmulet yang sudah jatuh tempo',
        };
      cid = expired.contractId;
      tmpl = expired.templateId;
    }
    if (!cid) return { ok: false, error: 'LockedAmulet cid tidak ditemukan' };
    if (!tmpl) {
      const ar = await this.fetchScanProxyContract('amulet-rules');
      const pkg = ar?.templateId?.split(':')[0];
      tmpl = pkg ? `${pkg}:Splice.Amulet:LockedAmulet` : null;
    }
    if (!tmpl)
      return { ok: false, error: 'templateId LockedAmulet tidak diketahui' };

    const disclosedContracts = [
      {
        templateId: openRound.templateId,
        contractId: openRound.contractId,
        createdEventBlob: openRound.blob,
      },
    ];

    const { ok, status, text } = await this.exerciseChoice(
      cid,
      tmpl,
      'LockedAmulet_OwnerExpireLockV2',
      {},
      [ownerParty],
      `unlock-cc-${randomUUID()}`,
      'submit-and-wait-for-transaction-tree',
      disclosedContracts,
    );

    if (!ok) {
      // Error ambigu (network/timeout/abort status 0, atau 5xx): command mungkin
      // sudah dieksekusi validator walau client tidak menerima response sukses.
      // Verifikasi ke chain: jika LockedAmulet sudah tidak aktif (di-archive),
      // berarti unlock sebenarnya sukses.
      if (this.isAmbiguousError(status) && cid) {
        this.logger.warn(
          `unlockCc ambiguous error ${status} — verifying on-chain…`,
        );
        const stillLocked = await this.isLockedAmuletActive(cid, ownerParty);
        if (!stillLocked) {
          this.logger.log(
            `unlockCc recovered: LockedAmulet ${cid.slice(0, 20)}… actually unlocked despite client error.`,
          );
          return { ok: true, unlockedCid: undefined };
        }
      }
      this.logger.warn(`unlockCc failed ${status}: ${text.slice(0, 500)}`);
      return { ok: false, error: `Ledger ${status}: ${text.slice(0, 400)}` };
    }
    const unlockedCid =
      this.findCreatedCidByTemplate(text, ':Splice.Amulet:Amulet') ?? undefined;
    // Extract updateId dari response exercise (untuk link explorer Modo). Konsisten
    // dengan pattern accept/reject TransferInstruction di file ini.
    let updateId: string | undefined;
    try {
      JSON.parse(text); // validasi JSON saja — throw ditangkap catch
      updateId = extractUpdateIdFromTree(text) ?? undefined;
    } catch {
      /* ignore parse error */
    }
    this.logger.log(
      `unlockCc OK amulet=${(unlockedCid ?? '?').slice(0, 20)}… updateId=${updateId?.slice(0, 16) ?? 'unknown'}`,
    );
    return { ok: true, unlockedCid, updateId };
  }

  /**
   * Cek apakah sebuah LockedAmulet (by contractId) masih AKTIF di ACS owner.
   * Dipakai untuk verifikasi: kalau sudah tidak aktif → sudah di-unlock.
   */
  private async isLockedAmuletActive(
    lockedAmuletCid: string,
    ownerParty: string,
  ): Promise<boolean> {
    await sleep(2500);
    try {
      const locked = await this.findLockedAmulets(ownerParty);
      return locked.some((l) => l.contractId === lockedAmuletCid);
    } catch (err) {
      this.logger.warn(`isLockedAmuletActive error: ${String(err)}`);
      // Kalau gagal cek, anggap masih aktif (konservatif → jangan palsukan sukses).
      return true;
    }
  }

  /** Cari contractId dari CreatedEvent pertama yang templateId-nya berakhiran `suffix`. */
  private findCreatedCidByTemplate(
    jsonText: string,
    suffix: string,
  ): string | null {
    let root: unknown;
    try {
      root = JSON.parse(jsonText);
    } catch {
      return null;
    }
    let out: string | null = null;
    const walk = (n: unknown, seen = new Set<unknown>()): void => {
      if (out || !n || typeof n !== 'object' || seen.has(n)) return;
      seen.add(n);
      const o = n as Record<string, any>;
      if (
        typeof o.templateId === 'string' &&
        o.templateId.endsWith(suffix) &&
        typeof o.contractId === 'string'
      ) {
        out = o.contractId;
        return;
      }
      for (const k of Object.keys(o)) walk(o[k], seen);
    };
    walk(root);
    return out;
  }
}

type LedgerStreamTransaction = {
  updateId: string;
  events?: LedgerStreamEvent[];
};

export type LedgerStreamEvent = {
  created?: {
    contractId: string;
    templateId: string;
    createArgument?: unknown;
  };
  archived?: {
    contractId: string;
    templateId: string;
  };
};

/** Extract first CreatedEvent contract id from submit-and-wait JSON response. */
function extractCreatedContractId(responseText: string): string | null {
  try {
    const parsed = JSON.parse(responseText) as Record<string, unknown>;
    if (typeof parsed.contractId === 'string' && parsed.contractId) {
      return parsed.contractId;
    }
    const stack: unknown[] = [parsed];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (Array.isArray(cur)) {
        for (const item of cur) stack.push(item);
        continue;
      }
      const rec = cur as Record<string, unknown>;
      if (typeof rec.contractId === 'string' && rec.contractId) {
        // CreatedTreeEvent.value or CreatedEvent payload
        if (
          rec.templateId !== undefined ||
          rec.createArgument !== undefined ||
          rec.createdEvent !== undefined ||
          rec.CreatedEvent !== undefined ||
          rec.CreatedTreeEvent !== undefined ||
          rec.eventType === 'created'
        ) {
          return rec.contractId;
        }
        // Wrapper: { CreatedTreeEvent: { value: { contractId, ... } } }
        const tree = rec.CreatedTreeEvent as
          | Record<string, unknown>
          | undefined;
        const inner = tree?.value as Record<string, unknown> | undefined;
        if (typeof inner?.contractId === 'string' && inner.contractId) {
          return inner.contractId;
        }
      }
      for (const v of Object.values(rec)) stack.push(v);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Extract Canton update_id ("1220…") dari response submit-and-wait ledger.
 *
 * Ledger Canton JSON API (:7575) membungkus updateId di dalam `transactionTree`:
 *   { "transactionTree": { "updateId": "1220…", "eventsById": {...} } }
 * Bukan di root. Helper ini membaca `transactionTree.updateId` (path resmi),
 * fallback ke root `updateId` (untuk response non-tree), lalu deep-search
 * field string apa pun yang diawali "1220" (safety net).
 */
function extractUpdateIdFromTree(responseText: string): string | null {
  try {
    const parsed = JSON.parse(responseText) as Record<string, unknown>;
    // 1. Path resmi: transactionTree.updateId
    const tree = parsed.transactionTree as Record<string, unknown> | undefined;
    if (typeof tree?.updateId === 'string' && tree.updateId) {
      return tree.updateId;
    }
    // 2. Root updateId (response non-tree, mis. beberapa endpoint lain)
    if (typeof parsed.updateId === 'string' && parsed.updateId) {
      return parsed.updateId;
    }
    // 3. Safety net: deep-search string pertama berawalan "1220"
    const stack: unknown[] = [parsed];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (Array.isArray(cur)) {
        for (const item of cur) stack.push(item);
        continue;
      }
      const rec = cur as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        if (k === 'updateId' && typeof v === 'string' && v.startsWith('1220')) {
          return v;
        }
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}
