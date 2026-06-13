import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

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
  private readonly secret: string | null;
  private readonly ledgerApiUser: string;
  private readonly ledgerAudience: string;
  /**
   * Scan API URL — hosts the Transfer Factory Registry (CIP-0056).
   * Required for executeTransferFactoryTransfer() to get factoryId + choiceContext.
   * Set via CANTON_SCAN_URL env var.
   */
  private readonly scanUrl: string | null;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      config.get<string>('CANTON_JSON_API_URL') ?? 'http://127.0.0.1:7575'
    ).replace(/\/$/, '');
    this.secret = config.get<string>('CANTON_SPLICE_SECRET') ?? null;
    this.ledgerApiUser =
      config.get<string>('CANTON_LEDGER_API_USER') ?? 'ledger-api-user';
    this.ledgerAudience =
      config.get<string>('CANTON_LEDGER_API_AUDIENCE') ?? 'https://canton.network.global';
    this.scanUrl = (
      config.get<string>('CANTON_SCAN_URL') ?? null
    )?.replace(/\/$/, '') ?? null;
  }

  /** JWT token for Canton JSON Ledger API calls. */
  private ledgerToken(actingUser?: string): string | null {
    if (!this.secret) return null;
    const sub = actingUser ?? this.ledgerApiUser;
    return jwt.sign(
      { sub, aud: this.ledgerAudience },
      this.secret,
      { algorithm: 'HS256', expiresIn: '5m' },
    );
  }

  private authHeaders(actingUser?: string): Record<string, string> {
    const token = this.ledgerToken(actingUser);
    if (!token) return { 'Content-Type': 'application/json' };
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
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
      this.logger.warn(`Canton JSON API not reachable at ${this.baseUrl}: ${String(err)}`);
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
    /** Use transaction-tree endpoint when CreatedEvent contract ids are needed. */
    waitMode: 'submit-and-wait' | 'submit-and-wait-for-transaction-tree' = 'submit-and-wait',
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
          headers: this.authHeaders(effectiveUserId),
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
          this.logger.warn(`Command fetch error (attempt ${attempt + 1}): ${String(err)} — retrying in ${delay}ms`);
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

    // The registry endpoint path per Token Standard OpenAPI spec
    const url = `${this.scanUrl}/api/scan/v2/registry/transfer-instruction/v1/transfer-factory`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.secret ? { Authorization: `Bearer ${this.ledgerToken()}` } : {}),
        },
        body: JSON.stringify({ choiceArguments }),
        signal: AbortSignal.timeout(20_000),
      });

      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(`Transfer Factory Registry ${res.status}: ${text.slice(0, 300)}`);
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
        this.logger.warn('Registry response missing factoryId or choiceContext');
        return null;
      }

      this.logger.log(
        `Registry OK: factory=${data.factoryId.slice(0, 16)}... kind=${data.transferKind ?? 'unknown'} ` +
        `disclosed=${data.choiceContext.disclosedContracts?.length ?? 0}`,
      );

      return {
        factoryId: data.factoryId,
        choiceContextData: data.choiceContext.choiceContextData ?? { values: {} },
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
  }): Promise<{
    ok: boolean;
    updateId: string | null;
    transferKind: string;
    transferInstructionCid?: string | null;
    error?: string;
  }> {
    const { senderPartyId, receiverPartyId, amountCc, description } = params;

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
    const dsoParty = this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() || '';
    if (!dsoParty) {
      return {
        ok: false,
        updateId: null,
        transferKind: 'unknown',
        error: 'CANTON_DSO_PARTY_ID is not set — required for CIP-0056 transfer',
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
        executeBefore: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        inputHoldingCids,
        meta: {
          values: description
            ? { 'splice.lfdecentralizedtrust.org/reason': description }
            : {},
        },
      },
      extraArgs: {
        context: { values: {} },  // Will be replaced with registry's choiceContextData
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
      `disclosed=${registry.disclosedContracts.length}`,
    );

    const { ok, status, text } = await this.exerciseChoice(
      registry.factoryId,
      factoryInterfaceId,
      'TransferFactory_Transfer',
      choiceArguments,
      [senderPartyId],
      commandId,
      'submit-and-wait-for-transaction-tree',
      registry.disclosedContracts,  // CIP-0056: pass disclosed contracts
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
      } catch { /* ignore */ }

      this.logger.log(
        `TransferFactory_Transfer OK: kind=${registry.transferKind} ` +
        `updateId=${updateId?.slice(0, 16) ?? 'unknown'} ` +
        (transferInstructionCid ? `instructionCid=${transferInstructionCid.slice(0, 16)}...` : ''),
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
    return { ok: false, updateId: null, transferKind: registry.transferKind, error: errMsg };
  }

  /**
   * CIP-0056 Two-Step Transfer — STEP 2A: RECEIVER menerima TransferInstruction.
   *
   * Interface: Splice.Api.Token.TransferInstructionV1:TransferInstruction
   * Choice:    TransferInstruction_Accept
   * Argument:  { extraArgs: { values: {} } }
   *
   * Dipanggil oleh receiver setelah sender membuat TransferInstruction via TransferFactory_Transfer.
   * Jika berhasil, holding CC berpindah ke receiver dan status menjadi TransferInstructionResult_Completed.
   *
   * @param transferInstructionCid - ContractId dari TransferInstruction (dari Step 1)
   * @param receiverPartyId - Canton party ID penerima (controller choice ini)
   * @returns { ok, updateId, error }
   */
  async acceptTransferInstruction(
    transferInstructionCid: string,
    receiverPartyId: string,
  ): Promise<{ ok: boolean; updateId: string | null; error?: string }> {
    // Interface ID dari DAML types (module.js line 49-51)
    const interfaceId =
      '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction';

    const commandId = `accept-instruction-${transferInstructionCid.slice(0, 16)}-${randomUUID().slice(0, 8)}`;

    this.logger.log(
      `TransferInstruction_Accept: receiver=${receiverPartyId.split('::')[0]} cid=${transferInstructionCid.slice(0, 16)}...`,
    );

    const { ok, status, text } = await this.exerciseChoice(
      transferInstructionCid,
      interfaceId,
      'TransferInstruction_Accept',
      { extraArgs: { values: {} } },
      [receiverPartyId],
      commandId,
      'submit-and-wait-for-transaction-tree',
    );

    if (ok) {
      let updateId: string | null = null;
      try {
        const parsed = JSON.parse(text) as { updateId?: string };
        updateId = parsed.updateId ?? null;
      } catch { /* ignore */ }
      this.logger.log(`TransferInstruction_Accept succeeded: updateId=${updateId?.slice(0, 16) ?? 'unknown'}`);
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

    const { ok, status, text } = await this.exerciseChoice(
      transferInstructionCid,
      interfaceId,
      'TransferInstruction_Reject',
      { extraArgs: { values: {} } },
      [receiverPartyId],
      commandId,
    );

    if (ok) {
      let updateId: string | null = null;
      try {
        const parsed = JSON.parse(text) as { updateId?: string };
        updateId = parsed.updateId ?? null;
      } catch { /* ignore */ }
      this.logger.log(`TransferInstruction_Reject succeeded: updateId=${updateId?.slice(0, 16) ?? 'unknown'}`);
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
      } catch { /* ignore */ }
      this.logger.log(`TransferInstruction_Withdraw succeeded: updateId=${updateId?.slice(0, 16) ?? 'unknown'}`);
      return { ok: true, updateId };
    }

    const errMsg = text.slice(0, 300);
    this.logger.warn(`TransferInstruction_Withdraw failed ${status}: ${errMsg}`);
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
      } catch { /* ignore */ }
      this.logger.log(`TransferOffer accepted: ${receiverPartyId.split('::')[0]} updateId: ${updateId ?? 'unknown'}`);
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
      } catch { /* ignore */ }
      this.logger.log(`TransferOffer rejected: ${receiverPartyId.split('::')[0]} updateId: ${updateId ?? 'unknown'}`);
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
        headers: this.authHeaders(),
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
      throw new ServiceUnavailableException('Canton returned non-JSON response.');
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
      headers: this.authHeaders(),
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
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { partyDetails?: unknown[] };
      return Array.isArray(data.partyDetails) && data.partyDetails.length > 0;
    } catch {
      return false;
    }
  }

  /** List parties visible to this participant. */
  async listParties(): Promise<unknown[]> {
    const res = await fetch(`${this.baseUrl}/v2/parties`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(6_000),
    });
    const text = await res.text();
    if (!res.ok) throw new ServiceUnavailableException(`Canton /v2/parties GET ${res.status}`);
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
    const tplId = '#splice-amulet:Splice.ExternalPartyAmuletRules:ExternalPartyAmuletRules';
    try {
      const contracts = await this.queryActiveContracts(tplId, [operatorPartyId]);
      for (const entry of contracts) {
        if (!entry || typeof entry !== 'object') continue;
        const obj = entry as Record<string, unknown>;
        const cid = typeof obj.contractId === 'string' ? obj.contractId
          : typeof (obj as { CreatedTreeEvent?: { contractId?: string } })?.CreatedTreeEvent?.contractId === 'string'
            ? (obj as { CreatedTreeEvent: { contractId: string } }).CreatedTreeEvent.contractId
            : null;
        if (cid) {
          this.logger.log(`Discovered TransferFactory: ${cid.slice(0, 16)}...`);
          return cid;
        }
      }
      this.logger.warn(`No ExternalPartyAmuletRules contract found for operator ${operatorPartyId.split('::')[0]}`);
      return null;
    } catch (err) {
      this.logger.warn(`discoverTransferFactoryContractId error: ${String(err)}`);
      return null;
    }
  }

  /** Returns current ledger-end offset. */
  async ledgerEnd(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/v2/state/ledger-end`, {
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(6_000),
    });
    const text = await res.text();
    if (!res.ok) throw new ServiceUnavailableException(`Canton ledger-end ${res.status}`);
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
    } catch { offset = 0; }

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
        headers: this.authHeaders(),
        body: JSON.stringify({
          eventFormat: {
            filtersByParty,
            filtersForAnyParty: { cumulative: [] },
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
        this.logger.warn(`queryAmuletHoldings wildcard ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      this.logger.warn(`queryAmuletHoldings error: ${String(err)}`);
    }

    // Client-side filter: only Splice.Amulet:Amulet contracts owned by this party
    const holdings: Array<{ contractId: string; amount: string }> = [];
    for (const entry of allContracts) {
      if (!entry || typeof entry !== 'object') continue;
      const wrapper = entry as Record<string, unknown>;
      const active = wrapper.contractEntry as Record<string, unknown> | undefined;
      const jsActive = active?.JsActiveContract as Record<string, unknown> | undefined;
      const ev = (jsActive?.createdEvent ?? wrapper) as Record<string, unknown>;

      const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
      if (!tplId.includes('Splice.Amulet:Amulet')) continue;

      const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
      const args = (ev.createArgument as Record<string, unknown> | undefined) ?? {};

      if (!cid) continue;

      // Check owner
      const cOwner = typeof args.owner === 'string' ? args.owner : '';
      if (cOwner && cOwner !== ownerPartyId) continue;

      // Extract amount from ExpiringAmount
      const amtRaw = args.amount as Record<string, unknown> | undefined;
      const amountStr =
        typeof amtRaw?.initialAmount === 'string' ? amtRaw.initialAmount
        : typeof amtRaw?.amount === 'string' ? amtRaw.amount
        : typeof args.amount === 'string' ? (args.amount as string)
        : '0';

      holdings.push({ contractId: cid, amount: amountStr });
    }

    this.logger.log(
      `Amulet ACS query (wildcard): party=${ownerPartyId.split('::')[0]} found ${holdings.length} holdings from ${allContracts.length} total contracts`,
    );
    return holdings;
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
        filtersForAnyParty: { cumulative: [] },
        verbose: false,
      },
      activeAtOffset: offset,
    };

    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 413) {
          // Participant has >200 contracts for this template — normal at scale.
          // Fallback: idempotency handled by command deduplication.
          this.logger.debug(`queryActiveContracts 413 (limit reached) — skipping ACS lookup, using command dedup`);
        } else {
          this.logger.warn(`queryActiveContracts ${res.status}: ${text.slice(0, 200)}`);
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
        headers: this.authHeaders(),
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
        (data.CreatedEvent as Record<string, unknown> | undefined)?.createArgument ??
        (data.CreatedTreeEvent as Record<string, unknown> | undefined)?.createArgument ??
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
        const cid =
          typeof obj.contractId === 'string'
            ? obj.contractId
            : null;

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
  ): Promise<{ ok: boolean; contractId: string | null; updateId: string | null; error?: string }> {
    const { ok, status, text } = await this.submitCommand(
      [{ CreateCommand: { templateId, createArguments } }],
      actAs,
      undefined,
      commandId,
      'submit-and-wait-for-transaction-tree',
    );

    if (ok) {
      try {
        const parsed = JSON.parse(text) as { updateId?: string; contractId?: string };
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
    return { ok: false, contractId: null, updateId: null, error: text.slice(0, 300) };
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
        filtersForAnyParty: { cumulative: [] },
      },
      beginExclusive,
    };

    const res = await fetch(`${this.baseUrl}/v2/updates/transactions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      // 404 = endpoint tidak tersedia di versi Canton JSON API ini (normal, tidak perlu log)
      // Endpoint ini opsional — hanya dipakai untuk transaction history lookup
      if (res.status !== 404) {
        const text = await res.text();
        this.logger.debug(`fetchTransactionUpdates ${res.status}: ${text.slice(0, 120)}`);
      }
      return [];
    }
    const data = (await res.json()) as { transactions?: LedgerStreamTransaction[] };
    return data.transactions ?? [];
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
        const tree = rec.CreatedTreeEvent as Record<string, unknown> | undefined;
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
