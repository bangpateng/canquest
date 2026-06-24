import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { KeycloakTokenService } from '../auth/keycloak-token.service';

/**
 * HTTP client for the Canton JSON Ledger API v2.
 *
 * Official Canton Network Documentation:
 *   https://docs.canton.network/appdev/modules/m4-json-api-tutorial
 *   https://docs.canton.network/appdev/modules/m4-backend-dev
 *   https://docs.canton.network/appdev/modules/m7-error-handling
 *
 * Setup (VPS 2 → VPS 1 participant):
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
 * Auth: Splice uses hs-256-unsafe in devnet/testnet. Set:
 *   CANTON_SPLICE_SECRET=unsafe
 *   CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
 *   CANTON_LEDGER_API_USER=ledger-api-user
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
    this.baseUrl = (
      (config.get<string>('LEDGER_API_URL') ||
        config.get<string>('CANTON_JSON_API_URL')) ??
      'http://127.0.0.1:7575'
    ).replace(/\/$/, '');
    this.ledgerApiUser =
      config.get<string>('CANTON_LEDGER_API_USER') ?? 'ledger-api-user';
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
    const effectiveUserId =
      userId ?? (process.env.LEDGER_API_ADMIN_USER || this.ledgerApiUser);
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
    } = params;

    // ── Step 1: Query sender's Amulet holdings for inputHoldingCids ──────
    const holdings = await this.queryAmuletHoldings(senderPartyId);
    if (holdings.length === 0) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'Sender has no Amulet holdings — cannot fund transfer',
      };
    }
    const inputHoldingCids = holdings.map((h) => h.contractId);

    // DSO party (instrumentId.admin) — from CANTON_DSO_PARTY_ID
    const dsoParty =
      this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '';
    if (!dsoParty) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error:
          'CANTON_DSO_PARTY_ID is not set — required for CIP-0056 transfer',
      };
    }

    const now = new Date();
    const amountNumeric = amountCc.toFixed(10);

    // ── Build choiceArguments per CIP-0056 spec ──────────────────────────
    // Reference: canton-network/splice/token-standard/cli/src/commands/transfer.ts
    const choiceArguments: Record<string, unknown> = {
      expectedAdmin: dsoParty,
      transfer: {
        sender: senderPartyId,
        receiver: receiverPartyId,
        amount: amountNumeric,
        instrumentId: {
          admin: dsoParty,
          id: 'Amulet',
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

    const commandId = `transfer-factory-${senderPartyId.slice(0, 12)}-${randomUUID().slice(0, 16)}`;

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
        const parsed = JSON.parse(text);
        updateId = parsed.updateId ?? null;
        // If transferKind = "offer", extract the TransferInstruction contract ID
        // from the CreatedEvent tree for the receiver to accept later
        if (registry.transferKind === 'offer') {
          transferInstructionCid = extractCreatedContractId(text);
        }
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
      return {
        ok: true,
        kind: 'offer',
        pending: true,
        rewardTxId: res.updateId ?? res.transferInstructionCid,
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

  /** ACS lookup: TransferPreapproval contract whose receiver === partyId. */
  private async findTransferPreapprovalContract(partyId: string): Promise<{
    contractId: string;
    templateId: string;
    expiresAt?: string;
    provider?: string;
  } | null> {
    let offset: number | string = 0;
    try {
      const end = (await this.ledgerEnd()) as { offset?: number | string };
      offset = end?.offset ?? 0;
    } catch {
      offset = 0;
    }

    let rows: unknown[] = [];
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
      if (!res.ok) {
        this.logger.warn(
          `findTransferPreapproval ${res.status}: ${(await res.text()).slice(0, 200)}`,
        );
        return null;
      }
      rows = (await res.json()) as unknown[];
      if (!Array.isArray(rows)) rows = [];
    } catch (err) {
      this.logger.warn(`findTransferPreapproval error: ${String(err)}`);
      return null;
    }

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
      const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
      const args =
        (ev.createArgument as Record<string, unknown> | undefined) ?? {};
      const receiver = typeof args.receiver === 'string' ? args.receiver : '';
      if (receiver === partyId && cid) {
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

  async cancelTransferPreapprovalViaLedger(
    partyId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const c = await this.findTransferPreapprovalContract(partyId);
    if (!c) return { ok: true }; // nothing to cancel
    this.logger.log(
      `Cancelling TransferPreapproval via Ledger: cid=${c.contractId.slice(0, 20)}…`,
    );
    const { ok, status, text } = await this.exerciseChoice(
      c.contractId,
      c.templateId,
      'TransferPreapproval_Cancel',
      {},
      [partyId],
    );
    if (ok) return { ok: true };
    this.logger.warn(
      `Cancel preapproval failed ${status}: ${text.slice(0, 200)}`,
    );
    return { ok: false, error: `Ledger ${status}: ${text.slice(0, 200)}` };
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
    this.logger.log(
      `TransferPreapproval created cid=${(cid ?? '?').slice(0, 20)}… amuletPaid=${amuletPaid ?? '?'}`,
    );
    return {
      ok: true,
      transferPreapprovalCid: cid ?? undefined,
      amuletPaid: amuletPaid ?? undefined,
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
  private async getInstructionChoiceContext(
    transferInstructionCid: string,
    action: 'accept' | 'reject' | 'withdraw',
  ): Promise<{
    choiceContextData: Record<string, unknown>;
    disclosedContracts: unknown[];
  } | null> {
    const validatorUrl = (
      this.config.get<string>('CANTON_VALIDATOR_URL') ?? 'http://127.0.0.1:8080'
    ).replace(/\/$/, '');
    const hostHeader =
      this.config.get<string>('CANTON_VALIDATOR_HOST_HEADER') ?? '';
    const scanBase = `${validatorUrl}/api/validator/v0/scan-proxy`;
    const encodedCid = encodeURIComponent(transferInstructionCid);
    const url = `${scanBase}/registry/transfer-instruction/v1/${encodedCid}/choice-contexts/${action}`;

    try {
      const headers = await this.authHeaders();
      if (hostHeader) headers['Host'] = hostHeader;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ excludeDebugFields: true }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.warn(
          `Choice context (${action}) ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }

      const data = (await res.json()) as {
        choiceContextData?: Record<string, unknown>;
        disclosedContracts?: unknown[];
      };

      this.logger.log(
        `Choice context (${action}) OK: disclosed=${data.disclosedContracts?.length ?? 0}`,
      );

      return {
        choiceContextData: data.choiceContextData ?? { values: {} },
        disclosedContracts: data.disclosedContracts ?? [],
      };
    } catch (err) {
      this.logger.warn(`Choice context (${action}) error: ${String(err)}`);
      return null;
    }
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

    // Get choiceContext from registry (required for disclosedContracts)
    const choiceCtx = await this.getInstructionChoiceContext(
      transferInstructionCid,
      'accept',
    );

    const choiceArgument = {
      extraArgs: {
        context: choiceCtx?.choiceContextData ?? { values: {} },
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
        updateId = parsed.updateId ?? null;
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

    const choiceCtx = await this.getInstructionChoiceContext(
      transferInstructionCid,
      'reject',
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
        updateId = parsed.updateId ?? null;
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
        updateId = parsed.updateId ?? null;
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
        updateId = parsed.updateId ?? null;
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
        updateId = parsed.updateId ?? null;
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
  async getCurrentRound(): Promise<number> {
    if (!this.keycloak) throw new Error('KeycloakTokenService not injected');
    const token = await this.keycloak.getAdminLedgerToken();
    const validatorUrl = (
      this.config.get<string>('CANTON_VALIDATOR_URL') ?? ''
    ).replace(/\/$/, '');
    const res = await fetch(`${validatorUrl}/api/validator/v0/wallet/balance`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`getCurrentRound gagal HTTP ${res.status}`);
    const data = (await res.json()) as { round?: number };
    if (!data.round)
      throw new Error('getCurrentRound: field round tidak ditemukan');
    return data.round;
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

        offers.push({
          type: 'transfer_instruction',
          contractId: cid,
          sender,
          receiver,
          amount,
          description: desc,
          expiresAt: executeBefore,
          createdAt: requestedAt,
        });
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
          updateId: parsed.updateId ?? null,
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
   * Operator ID from LEDGER_API_ADMIN_USER env.
   * IDEMPOTEN: 409 / ALREADY_EXISTS diabaikan.
   */
  async grantOperatorRightsOnParty(partyId: string): Promise<void> {
    const operatorId = process.env.LEDGER_API_ADMIN_USER;
    if (!operatorId) {
      this.logger.error(
        'LEDGER_API_ADMIN_USER belum diset — operator rights TIDAK di-grant',
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
  // CC LOCK (non-custodial) — self-lock via native LockedAmulet
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
    this.logger.log(
      `lockCc OK lockedAmuletCid=${(lockedAmuletCid ?? '?').slice(0, 20)}…`,
    );
    return { ok: true, lockedAmuletCid, expiresAt };
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
  ): Promise<{ ok: boolean; unlockedCid?: string; error?: string }> {
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
    this.logger.log(`unlockCc OK amulet=${(unlockedCid ?? '?').slice(0, 20)}…`);
    return { ok: true, unlockedCid };
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

/** Exponential-backoff sleep helper (milliseconds). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
