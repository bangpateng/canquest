import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

/**
 * HTTP client for the Canton JSON Ledger API v2.
 *
 * Docs: https://docs.digitalasset.com/build/3.5/tutorials/json-api/canton_and_the_json_ledger_api.html
 *
 * Setup (VPS 2 → VPS 1 participant):
 *   1. Get participant Docker IP on VPS 1:
 *      docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1
 *   2. Open SSH tunnel (keep terminal open):
 *      ssh -N -L 7575:<DOCKER_IP>:7575 user@VPS1_IP
 *   3. Set env: CANTON_JSON_API_URL=http://127.0.0.1:7575
 *   4. Verify: curl http://127.0.0.1:7575/livez  → HTTP 200
 *
 * Auth: Splice uses hs-256-unsafe in devnet. Set:
 *   CANTON_SPLICE_SECRET=unsafe
 *   CANTON_LEDGER_API_AUDIENCE=https://ledger_api.example.com
 *   CANTON_LEDGER_API_USER=ledger-api-user
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

  /** Quick health check — returns false if JSON API unreachable (never throws). */
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
   * Submit a command to the Canton JSON Ledger API v2.
   *
   * The correct body format (per docs) is FLAT — commands is a top-level array:
   * { "commands": [...], "userId": "...", "actAs": [...], ... }
   * NOT nested like { "commands": { "commands": [...] } }
   */
  private async submitCommand(
    commands: unknown[],
    actAs: string[],
    userId?: string,
  ): Promise<{ ok: boolean; status: number; text: string }> {
    const url = `${this.baseUrl}/v2/commands/submit-and-wait`;
    const effectiveUserId = userId ?? this.ledgerApiUser;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(effectiveUserId),
        body: JSON.stringify({
          commands,
          userId: effectiveUserId,
          commandId: randomUUID(),
          actAs,
          readAs: actAs,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } catch (err) {
      return { ok: false, status: 0, text: String(err) };
    }
  }


  /**
   * Exercise a choice on the Canton JSON Ledger API v2.
   */
  async exerciseChoice(
    contractId: string,
    templateId: string,
    choiceName: string,
    choiceArgument: unknown,
    actAs: string[],
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
        rights: [
          { CanActAs: { party: partyId } },
          { CanReadAs: { party: partyId } },
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
}
