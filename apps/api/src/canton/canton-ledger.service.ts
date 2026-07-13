import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { KeycloakTokenService } from '../auth/keycloak-token.service';
import {
  cantonPartyIdsEqual,
  normalizeCantonPartyId,
} from '../common/canton-party-id';

/**
 * HTTP client for the Canton JSON Ledger API v2.
 *
 * Official Canton Network Documentation:
 *   https://docs.canton.network/appdev/modules/m4-json-api-tutorial
 *   https://docs.canton.network/appdev/modules/m4-backend-dev
 *   https://docs.canton.network/appdev/modules/m7-error-handling
 *
 * PROD setup (recommended — no SSH tunnel):
 *   LEDGER_API_URL=https://api-ledger-canquest.nodelab.my.id
 *   LEDGER_AUTH_MODE=keycloak
 *   LEDGER_API_ADMIN_USER=<UUID admin Keycloak>  (userId for submit / grant rights)
 *   Verify: curl https://api-ledger-canquest.nodelab.my.id/livez  → HTTP 200
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
 *   - INVALID_ARGUMENT              → bug in payload → do not retry
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
  ) {
    // LEDGER_API_URL wajib di prod (gateway publik api-ledger-canquest.nodelab.my.id).
    // Fallback ke CANTON_JSON_API_URL hanya untuk dev (SSH tunnel localhost:7575).
    // JANGAN pernah fallback ke localhost di produksi — itu menyembunyikan misconfig.
    const ledgerUrl =
      config.get<string>('LEDGER_API_URL') ||
      config.get<string>('CANTON_JSON_API_URL');
    if (!ledgerUrl) {
      throw new Error(
        'LEDGER_API_URL (atau CANTON_JSON_API_URL) belum diset — ' +
          'prod: https://api-ledger-canquest.nodelab.my.id',
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
   * The registry is served by the Scan API. It returns:
   *   - factoryId: contract ID of the TransferFactory to exercise
   *   - choiceContext.choiceContextData: goes into extraArgs.context
   *   - choiceContext.disclosedContracts: must be passed to submitCommand
   *   - transferKind: "direct" (preapproval) or "offer" (2-step)
   *
   * Reference: https://github.com/canton-network/splice/blob/main/token-standard/cli/src/commands/transfer.ts
   * CIP-0056: https://github.com/global-synchronizer-foundation/cips/blob/main/cip-0056/cip-0056.md
   */
  async callTransferFactoryRegistry(choiceArguments: unknown): Promise<{
    factoryId: string;
    choiceContextData: Record<string, unknown>;
    disclosedContracts: unknown[];
    transferKind: string;
  } | null> {
    if (!this.scanUrl) {
      this.logger.error(
        'CANTON_SCAN_URL is not set — cannot call Transfer Factory Registry. ' +
          'Set it to your Scan API URL (e.g. https://scan.sv-1.test.global.canton.network.sync.global)',
      );
      return null;
    }

    // Build URL: prefer scan-proxy on validator (uses same auth + Host as wallet API)
    const validatorUrl = (
      this.config.get<string>('CANTON_VALIDATOR_URL') ?? 'http://127.0.0.1:8080'
    ).replace(/\/$/, '');
    const hostHeader =
      this.config.get<string>('CANTON_VALIDATOR_HOST_HEADER') ?? '';

    // Always use validator's scan-proxy — proven to work on MainNet
    // Scan-proxy is at: ${validatorUrl}/api/validator/v0/scan-proxy
    const scanBase = `${validatorUrl}/api/validator/v0/scan-proxy`;
    const url = `${scanBase}/registry/transfer-instruction/v1/transfer-factory`;

    this.logger.log(`Registry call: ${url} Host=${hostHeader || '(none)'}`);

    try {
      const headers = await this.authHeaders();
      // MUST send Host header when going through nginx on validator
      if (hostHeader) headers['Host'] = hostHeader;

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

      this.logger.log(
        `Registry OK: factory=${data.factoryId.slice(0, 16)}... kind=${data.transferKind ?? 'unknown'} ` +
          `disclosed=${data.choiceContext.disclosedContracts?.length ?? 0}`,
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
  async executeTransferFactoryTransfer(params: {
    senderPartyId: string;
    receiverPartyId: string;
    amountCc: number;
    description?: string;
    /**
     * Ledger identity to use for authentication.
     * 'admin'  → validator-app-backend (general operations, default)
     * 'reward' → reward client (CC reward transfers — JOB_SEND_CC_REWARD, JOB_DISTRIBUTE_REWARD)
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
    // admin di-resolve dari Cantex getPools/getAccountInfo (instrumentAdmin param).
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
    // Dispatch: Amulet pakai queryAmuletHoldings (struktur khusus), non-CC
    // pakai queryTokenHoldings generic (filter by instrument field).
    const holdings = isAmulet
      ? await this.queryAmuletHoldings(senderPartyId)
      : await this.queryTokenHoldings(
          senderPartyId,
          instrumentId,
          effectiveAdmin,
        );
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
    const registry = await this.callTransferFactoryRegistry(choiceArguments);
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
        `receiver=${receiverPartyId.split('::')[0]} amount=${amountCc} CC ` +
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
   * ACS lookup: TransferPreapproval contract whose receiver === partyId.
   *
   * @param partyId - The receiver party whose preapproval we want to find.
   * @param visibilityParty - Party whose contract store we query (ACS visibility).
   *   Defaults to `partyId` (the receiver). The validator/provider party may see
   *   contracts the receiver does not (e.g. if the operator lacks CanReadAs on
   *   the receiver), so callers can pass the provider party here.
   */
  private async findTransferPreapprovalContract(
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

  async hasTransferPreapprovalViaLedger(partyId: string): Promise<boolean> {
    return (await this.findTransferPreapprovalContract(partyId)) !== null;
  }

  async getTransferPreapprovalViaLedger(
    partyId: string,
  ): Promise<{ expiresAt?: string; provider?: string } | null> {
    const c = await this.findTransferPreapprovalContract(partyId);
    return c ? { expiresAt: c.expiresAt, provider: c.provider } : null;
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
      const { ok, status, text } = await this.exerciseChoice(
        c.contractId,
        c.templateId,
        'TransferPreapproval_Cancel',
        {},
        [actAs],
      );
      if (ok) {
        // Extract updateId (Canton tx id) dari response untuk pencatatan history.
        let updateId: string | undefined;
        try {
          const parsed = JSON.parse(text) as { updateId?: string };
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
      await new Promise((r) => setTimeout(r, delayMs));
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
      const parsed = JSON.parse(text) as { updateId?: string };
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
  private async fetchScanProxyContract(
    seg: 'amulet-rules' | 'open-and-issuing-mining-rounds',
  ): Promise<{
    contractId: string;
    templateId: string;
    blob: string;
    round?: number;
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
    return a.startsWith('dso::') || a.includes('amulet') || a.includes('splice');
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

  private async getInstructionChoiceContext(
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
        const parsed = JSON.parse(text) as { updateId?: string };
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
        const parsed = JSON.parse(text) as { updateId?: string };
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
   * Argument:  { extraArgs: { values: {} } }
   *
   * Sender membatalkan transfer sebelum receiver accept/reject.
   * Holding CC dikembalikan ke sender.
   *
   * @param transferInstructionCid - ContractId dari TransferInstruction (dari Step 1)
   * @param senderPartyId - Canton party ID pengirim (controller choice ini)
   * @returns { ok, updateId, error }
   */
  async withdrawTransferInstruction(
    transferInstructionCid: string,
    senderPartyId: string,
  ): Promise<{ ok: boolean; updateId: string | null; error?: string }> {
    const interfaceId =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

    const commandId = `withdraw-instruction-${transferInstructionCid.slice(0, 16)}-${randomUUID().slice(0, 8)}`;

    this.logger.log(
      `TransferInstruction_Withdraw: sender=${senderPartyId.split('::')[0]} cid=${transferInstructionCid.slice(0, 16)}...`,
    );

    const { ok, status, text } = await this.exerciseChoice(
      transferInstructionCid,
      interfaceId,
      'TransferInstruction_Withdraw',
      { extraArgs: { values: {} } },
      [senderPartyId],
      commandId,
    );

    if (ok) {
      let updateId: string | null = null;
      try {
        const parsed = JSON.parse(text) as { updateId?: string };
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
        const parsed = JSON.parse(text) as { updateId?: string };
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
        const parsed = JSON.parse(text) as { updateId?: string };
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
   * Verify a Party ID exists on this participant.
   * GET /v2/parties?parties=<partyId>
   */
  async verifyParty(partyId: string): Promise<boolean> {
    try {
      const encoded = encodeURIComponent(partyId);
      const res = await fetch(`${this.baseUrl}/v2/parties?parties=${encoded}`, {
        headers: await this.authHeaders(),
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { partyDetails?: unknown[] };
      return Array.isArray(data.partyDetails) && data.partyDetails.length > 0;
    } catch {
      return false;
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
  private async queryAmuletHoldingsRaw(partyId: string): Promise<
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
      if (res.ok) {
        allContracts = (await res.json()) as unknown[];
        if (!Array.isArray(allContracts)) allContracts = [];
      } else {
        const text = await res.text();
        this.logger.warn(
          `queryAmuletHoldingsRaw ${res.status}: ${text.slice(0, 200)}`,
        );
      }
    } catch (err) {
      this.logger.warn(`queryAmuletHoldingsRaw error: ${String(err)}`);
      return [];
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
      if (owner !== partyId) continue;
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
    this.logger.debug(
      `Balance Ledger: party=${partyId.split('::')[0]} = ${total} CC (${holdings.length} Amulets, round ${currentRound})`,
    );
    return total;
  }

  /** List parties visible to this participant. */
  async listParties(): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/v2/parties`, {
      headers: await this.authHeaders(),
      signal: AbortSignal.timeout(6_000),
    });
    const text = await res.text();
    if (!res.ok)
      throw new ServiceUnavailableException(
        `Canton /v2/parties GET ${res.status}`,
      );
    return (JSON.parse(text) as { partyDetails: unknown[] }).partyDetails ?? [];
  }

  /**
   * Auto-discover the ExternalPartyAmuletRules factory contract ID from the ledger.
   * Queries ACS for Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules visible to the operator.
   * No need to configure CANTON_TRANSFER_FACTORY_CONTRACT_ID in .env.
   */
  async discoverTransferFactoryContractId(
    operatorPartyId: string,
  ): Promise<string | null> {
    const tplId =
      '#splice-amulet:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules';
    try {
      const contracts = await this.queryActiveContracts(tplId, [
        operatorPartyId,
      ]);
      for (const entry of contracts) {
        if (!entry || typeof entry !== 'object') continue;
        const obj = entry as Record<string, unknown>;
        const cid =
          typeof obj.contractId === 'string'
            ? obj.contractId
            : typeof (obj as { CreatedTreeEvent?: { contractId?: string } })
                  ?.CreatedTreeEvent?.contractId === 'string'
              ? (obj as { CreatedTreeEvent: { contractId: string } })
                  .CreatedTreeEvent.contractId
              : null;
        if (cid) {
          this.logger.log(`Discovered TransferFactory: ${cid.slice(0, 16)}...`);
          return cid;
        }
      }
      this.logger.warn(
        `No ExternalPartyAmuletRules contract found for operator ${operatorPartyId.split('::')[0]}`,
      );
      return null;
    } catch (err) {
      this.logger.warn(
        `discoverTransferFactoryContractId error: ${String(err)}`,
      );
      return null;
    }
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
        const text = await res.text();
        this.logger.warn(
          `queryAmuletHoldings wildcard ${res.status}: ${text.slice(0, 200)}`,
        );
      }
    } catch (err) {
      this.logger.warn(`queryAmuletHoldings error: ${String(err)}`);
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

    this.logger.log(
      `Amulet ACS query (wildcard): party=${ownerPartyId.split('::')[0]} found ${holdings.length} holdings from ${allContracts.length} total contracts`,
    );
    return holdings;
  }

  /**
   * Query holding generic untuk token APA PUN (CC/Amulet + non-CC: USDCx, CBTC, dll).
   *
   * Memakai WildcardFilter + client-side filter by createArgument.instrument.
   * Token standard Canton (CIP-0056) expose holding via interface HoldingV1
   * dengan field: owner, instrumentId {admin, id}, amount. Filter client-side
   * cocokkan instrumentId + admin + owner.
   *
   * Untuk CC/Amulet, fallback ke queryAmuletHoldings (struktur field berbeda:
   * Amulet punya amount.initialAmount, bukan flat amount).
   *
   * @param ownerPartyId - Canton party ID pemilik holding
   * @param instrumentId - Instrument id token (mis. "USDCx")
   * @param instrumentAdmin - Admin party instrument
   * @param readAs - parties dengan read rights
   * @returns Array of { contractId, amount }
   */
  async queryTokenHoldings(
    ownerPartyId: string,
    instrumentId: string,
    instrumentAdmin: string,
    readAs?: string[],
  ): Promise<Array<{ contractId: string; amount: string }>> {
    // Amulet/CC punya struktur khusus — pakai method existing yang proven.
    if (instrumentId.toLowerCase() === 'amulet') {
      return this.queryAmuletHoldings(ownerPartyId, readAs);
    }

    const effectiveReadAs = readAs ?? [ownerPartyId];

    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }

    const filtersByParty: Record<string, unknown> = {};
    for (const party of effectiveReadAs) {
      filtersByParty[party] = {
        cumulative: [
          {
            identifierFilter: {
              WildcardFilter: { value: { includeCreatedEventBlob: false } },
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
          `queryTokenHoldings wildcard ${res.status}: ${text.slice(0, 200)}`,
        );
      }
    } catch (err) {
      this.logger.warn(`queryTokenHoldings error: ${String(err)}`);
    }

    // Client-side filter: holding contracts dengan instrument + owner match.
    // Defensive parsing: holding USDCx (utility-registry-holding) mungkin punya
    // field shape beda dari CC (Amulet). Coba beberapa conventions:
    //   - nested: args.instrument = { id, admin }
    //   - flat: args.instrumentId = { id, admin }  ATAU  args.instrumentAdmin + args.instrumentId
    //   - registry-app: args.instrument = { admin, id } atau args.transfer.instrumentId
    const targetId = instrumentId.toLowerCase();
    const targetAdmin = instrumentAdmin.toLowerCase();
    const holdings: Array<{ contractId: string; amount: string }> = [];
    let skippedForDebug = 0;
    let dumpedShapes = 0;
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
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};
      if (!cid) continue;

      // DEBUG: dump createArgument shape untuk contract dengan template
      // mengandung 'Holding' (bukan Amulet). Maksimal 2 dump supaya log tidak
      // banjir. Tujuan: lihat field apa yang pegang instrument id + admin.
      const evTplId = typeof ev.templateId === 'string' ? ev.templateId : '';
      const tplIdLower = evTplId.toLowerCase();
      if (
        dumpedShapes < 2 &&
        tplIdLower.includes('holding') &&
        !tplIdLower.includes('amulet')
      ) {
        dumpedShapes++;
        this.logger.warn(
          `HOLDING DUMP [${instrumentId}] tplId=${evTplId.slice(0, 60)}… ` +
            `args keys=[${Object.keys(args).join(',')}] ` +
            `args=${JSON.stringify(args).slice(0, 500)}`,
        );
      }

      // Coba extract instrument id + admin dari beberapa field shapes.
      let instId = '';
      let instAdmin = '';

      // Shape 1: nested args.instrument = { id, admin }
      const instNested = args.instrument as
        | { id?: string; admin?: string }
        | undefined;
      if (instNested?.id) {
        instId = instNested.id.toLowerCase();
        instAdmin = (instNested.admin ?? '').toLowerCase();
      }

      // Shape 2: args.instrumentId = { id, admin } (registry-app style)
      if (!instId) {
        const instIdField = args.instrumentId as
          | { id?: string; admin?: string }
          | string
          | undefined;
        if (typeof instIdField === 'object' && instIdField?.id) {
          instId = instIdField.id.toLowerCase();
          instAdmin = (instIdField.admin ?? '').toLowerCase();
        } else if (typeof instIdField === 'string') {
          instId = instIdField.toLowerCase();
        }
      }

      // Shape 3: flat args.instrumentAdmin + args.instrumentId (string)
      if (!instId && typeof args.instrumentAdmin === 'string') {
        instAdmin = (args.instrumentAdmin as string).toLowerCase();
        if (typeof args.instrumentId === 'string') {
          instId = (args.instrumentId as string).toLowerCase();
        }
      }

      // Shape 4: nested di args.transfer.instrumentId (beberapa TransferOffer shape)
      if (!instId) {
        const transfer = args.transfer as
          | { instrumentId?: { id?: string; admin?: string } }
          | undefined;
        const tInst = transfer?.instrumentId;
        if (tInst?.id) {
          instId = tInst.id.toLowerCase();
          instAdmin = (tInst.admin ?? '').toLowerCase();
        }
      }

      // Match instrument (case-insensitive). Kalau tidak match, skip.
      if (instId !== targetId || instAdmin !== targetAdmin) {
        skippedForDebug++;
        continue;
      }

      // Match owner (beberapa field name: owner, receiver, holder).
      const cOwner =
        typeof args.owner === 'string'
          ? args.owner
          : typeof args.receiver === 'string'
            ? args.receiver
            : '';
      if (cOwner && cOwner !== ownerPartyId) continue;

      // Extract amount (defensive: flat string, nested initialAmount, atau amount object).
      const amtRaw = args.amount as Record<string, unknown> | undefined;
      const amountStr =
        typeof amtRaw?.initialAmount === 'string'
          ? amtRaw.initialAmount
          : typeof amtRaw?.amount === 'string'
            ? amtRaw.amount
            : typeof args.amount === 'string'
              ? args.amount
              : typeof args.balance === 'string'
                ? args.balance
                : '0';

      holdings.push({ contractId: cid, amount: amountStr });
    }

    if (holdings.length === 0 && skippedForDebug > 0) {
      this.logger.warn(
        `queryTokenHoldings: 0 holdings matched instrument=${instrumentId} ` +
          `admin=${instrumentAdmin.slice(0, 24)}… (${skippedForDebug} contracts skipped). ` +
          `Field shape holding USDCx mungkin berbeda — perlu dump createArgument untuk debug.`,
      );
    }

    this.logger.log(
      `Token ACS query: party=${ownerPartyId.split('::')[0]} instrument=${instrumentId} found ${holdings.length} holdings from ${allContracts.length} total contracts`,
    );
    return holdings;
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
  async queryPendingOffers(partyId: string): Promise<
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
        // Only show offers where this party is the RECEIVER
        if (receiver !== partyId) continue;

        const sender = typeof args.sender === 'string' ? args.sender : '';
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
        // Only show instructions where this party is the RECEIVER
        if (receiver !== partyId) continue;

        const sender =
          typeof transfer.sender === 'string' ? transfer.sender : '';
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
        // Only show offers where this party is the RECEIVER.
        if (receiver !== partyId) continue;

        const sender = typeof transfer.sender === 'string' ? transfer.sender : '';
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
          typeof instObj === 'string'
            ? instObj
            : (instObj?.id ?? '');
        const instrAdmin =
          typeof instObj === 'object' ? instObj.admin ?? '' : '';

        const meta = transfer.meta as
          | Record<string, Record<string, string>>
          | undefined;
        const desc =
          meta?.values?.['splice.lfdecentralizedtrust.org/reason'] ??
          (typeof transfer.description === 'string' ? transfer.description : '');
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
   * Fetch a contract by its DAML key using the Canton JSON Ledger API v2.
   *
   * POST /v2/contracts/by-key
   *
   * Body per official docs:
   * {
   *   "templateId": "<packageId>:<ModuleName>:<TemplateName>",
   *   "key": { ... },       // e.g. { "_1": "party", "_2": "username" } for (Party, Text) key
   *   "readAs": ["party"]
   * }
   *
   * NOTE: `/v2/contracts/by-key` may not be available in all Canton versions.
   * If the endpoint returns 404, we fall back to queryActiveContracts and
   * apply the key-based filter client-side.
   *
   * Returns the contract entry (with contractId) if found, null if not found,
   * or throws on permission / transport errors.
   *
   * See: https://docs.canton.network/appdev/modules/m3-contract-keys
   */
  async fetchByKey(
    templateId: string,
    key: unknown,
    readAs: string[],
  ): Promise<{ contractId: string; createArgument?: unknown } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/v2/contracts/by-key`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({ templateId, key, readAs }),
        signal: AbortSignal.timeout(10_000),
      });

      // 404 = endpoint not available on this participant version
      // → fall back to ACS query + client-side key match
      if (res.status === 404) {
        this.logger.debug(
          `/v2/contracts/by-key returned 404 — falling back to ACS query`,
        );
        return this.fetchByKeyViaAcs(templateId, key, readAs);
      }

      if (!res.ok) {
        const text = await res.text();
        this.logger.warn(`fetchByKey ${res.status}: ${text.slice(0, 200)}`);
        return null;
      }

      const data = (await res.json()) as Record<string, unknown>;
      // Response may be { contractId, createArgument } or wrapped in CreatedEvent
      const contractId =
        typeof data.contractId === 'string' ? data.contractId : null;
      const args = (data.createArgument ??
        (data.CreatedEvent as Record<string, unknown> | undefined)
          ?.createArgument ??
        (data.CreatedTreeEvent as Record<string, unknown> | undefined)
          ?.createArgument ??
        null) as Record<string, unknown> | null;

      if (!contractId) return null;
      return { contractId, createArgument: args ?? undefined };
    } catch (err) {
      this.logger.warn(`fetchByKey error: ${String(err)}`);
      return null;
    }
  }

  /**
   * Fallback: query ACS for the template and filter by key client-side.
   * Used when `/v2/contracts/by-key` is not available (older Canton versions).
   *
   * keyMatch is a simple shallow comparison of the DAML createArguments fields
   * against the provided key record. For canonical Canton key serialisation,
   * keys are compared via Daml-LF value equality, but for our internal app
   * templates this shallow match is sufficient.
   */
  private async fetchByKeyViaAcs(
    templateId: string,
    key: unknown,
    readAs: string[],
  ): Promise<{ contractId: string; createArgument?: unknown } | null> {
    try {
      const contracts = await this.queryActiveContracts(templateId, readAs);
      const keyObj = key as Record<string, unknown>;

      for (const entry of contracts) {
        if (!entry || typeof entry !== 'object') continue;
        const obj = entry as Record<string, unknown>;
        const args =
          (obj.createArgument as Record<string, unknown> | undefined) ??
          ((obj.CreatedTreeEvent as Record<string, unknown> | undefined)
            ?.createArgument as Record<string, unknown> | undefined) ??
          ((obj.CreatedEvent as Record<string, unknown> | undefined)
            ?.createArgument as Record<string, unknown> | undefined);
        const cid = typeof obj.contractId === 'string' ? obj.contractId : null;

        if (!args || !cid) continue;

        // Shallow key match — compare every key in keyObj against args
        let match = true;
        for (const [k, v] of Object.entries(keyObj)) {
          if (args[k] !== v) {
            match = false;
            break;
          }
        }
        if (match) return { contractId: cid, createArgument: args };
      }
    } catch (err) {
      this.logger.warn(`fetchByKeyViaAcs error: ${String(err)}`);
    }
    return null;
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
      const parsed = JSON.parse(text) as { updateId?: string };
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

  /** Daftar LockedAmulet milik ownerParty (untuk eligibility & unlock). */
  async findLockedAmulets(ownerParty: string): Promise<
    Array<{
      contractId: string;
      templateId: string;
      amount: number;
      expiresAt: string;
      holders: string[];
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
      const parsed = JSON.parse(text) as { updateId?: string };
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

/** Exponential-backoff sleep helper (milliseconds). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
