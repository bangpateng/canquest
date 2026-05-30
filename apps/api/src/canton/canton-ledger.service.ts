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

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      config.get<string>('CANTON_JSON_API_URL') ?? 'http://127.0.0.1:7575'
    ).replace(/\/$/, '');
    this.secret = config.get<string>('CANTON_SPLICE_SECRET') ?? null;
    this.ledgerApiUser =
      config.get<string>('CANTON_LEDGER_API_USER') ?? 'ledger-api-user';
    this.ledgerAudience =
      config.get<string>('CANTON_LEDGER_API_AUDIENCE') ?? 'https://canton.network.global';
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
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const url = `${this.baseUrl}/v2/commands/${waitMode}`;
    const effectiveUserId = userId ?? this.ledgerApiUser;
    const effectiveCommandId = commandId ?? randomUUID();

    const MAX_RETRIES = 3;
    const RETRYABLE_STATUSES = new Set([408, 409, 429, 503]);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: this.authHeaders(effectiveUserId),
          body: JSON.stringify({
            commands,
            userId: effectiveUserId,
            commandId: effectiveCommandId,
            actAs,
            readAs: actAs,
          }),
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
  async exerciseChoice(
    contractId: string,
    templateId: string,
    choiceName: string,
    choiceArgument: unknown,
    actAs: string[],
    commandId?: string,
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
    );
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
        this.logger.warn(`queryActiveContracts ${res.status}: ${text.slice(0, 200)}`);
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
      const text = await res.text();
      this.logger.debug(`fetchTransactionUpdates ${res.status}: ${text.slice(0, 120)}`);
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
