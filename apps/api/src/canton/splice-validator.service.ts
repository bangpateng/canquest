import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  cantonPartyIdsEqual,
  normalizeCantonPartyId,
  spliceWalletUsernameFromParty,
} from '../common/canton-party-id';
import { KeycloakTokenService } from '../auth/keycloak-token.service';
import { CantonLedgerService } from './canton-ledger.service';

/**
 * Client for the Splice Validator App REST API.
 *
 * Official Canton Network documentation:
 *   https://docs.canton.network/appdev/modules/m7-canton-coin-preapprovals
 *   https://docs.canton.network/appdev/modules/m4-canton-coin
 *
 * Responsibilities:
 *   - Onboard a new party as a Splice wallet user (validator creates the
 *     Canton Party + registers the user in Splice in a single call).
 *   - Create / accept TransferOffer contracts for CC reward distribution.
 *   - Manage TransferPreapproval contracts (CIP-56 compliance).
 *     A TransferPreapproval allows any sender to transfer CC to the holder
 *     without the offer/accept round-trip.
 *     See: https://docs.canton.network/appdev/modules/m7-canton-coin-preapprovals
 *
 * Setup — PROD (recommended, no SSH tunnel):
 *
 *   # apps/api/.env:
 *   CANTON_VALIDATOR_URL=https://api-canquest.nodelab.my.id
 *   CANTON_VALIDATOR_HOST_HEADER=                 # KOSONG — gateway route via SNI/Host domain
 *
 * Setup — DEV (SSH tunnel from VPS 2 to VPS 1):
 *
 *   # Get validator Docker IP on VPS 1:
 *   docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-validator-1
 *
 *   # Open tunnel:
 *   ssh -N -L 5003:<DOCKER_IP>:5003 root@VPS1_IP
 *   # Or via nginx reverse proxy on port 8080:
 *   ssh -N -L 8080:127.0.0.1:80 root@VPS1_IP
 *
 *   # Set in apps/api/.env:
 *   CANTON_VALIDATOR_URL=http://127.0.0.1:5003
 *   CANTON_VALIDATOR_HOST_HEADER=wallet.localhost   # required when routing through nginx
 *
 * Auth — Keycloak client_credentials (LEDGER_AUTH_MODE=keycloak), the ONLY supported mode.
 * Legacy hs-256-unsafe / CANTON_SPLICE_SECRET removed.
 *
 * TransferPreapproval lifecycle (per Canton docs):
 *   1. Created via POST /api/validator/v0/wallet/transfer-preapproval (as user; singular path)
 *   2. Expires after 90 days — auto-renewed by validator if provider = validator
 *   3. Cancelled via DELETE /v0/admin/transfer-preapprovals/by-party/{party}
 */
@Injectable()
export class SpliceValidatorService {
  private readonly logger = new Logger(SpliceValidatorService.name);
  private readonly baseUrl: string | null;
  /**
   * Host header to send on every request to the Splice Validator API.
   *
   * VPS 1 nginx routes by server_name, not by port:
   *   wallet.localhost          → validator:5003  (Splice Wallet + Admin API)
   *   json-ledger-api.localhost → participant:7575 (Canton JSON Ledger API)
   *
   * When tunnelling VPS2:8080 → VPS1:127.0.0.1:80 we must set
   * Host: wallet.localhost so nginx forwards to the right upstream.
   *
   * Set CANTON_VALIDATOR_HOST_HEADER=wallet.localhost in .env (default).
   * Leave empty/unset to skip the custom Host header (e.g. direct port 5003).
   */
  private readonly hostHeader: string | null;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly keycloak: KeycloakTokenService,
    @Optional() private readonly ledger: CantonLedgerService,
  ) {
    const raw = config.get<string>('CANTON_VALIDATOR_URL');
    this.baseUrl = raw ? raw.replace(/\/$/, '') : null;
    // Host header kosong secara default di prod: gateway publik (api-canquest.nodelab.my.id)
    // route via SNI/Host domain, bukan wallet.localhost nginx. Dev SSH-tunnel masih bisa
    // override via CANTON_VALIDATOR_HOST_HEADER=wallet.localhost.
    this.hostHeader = config.get<string>('CANTON_VALIDATOR_HOST_HEADER') ?? '';
    // Fail fast at boot if LEDGER_AUTH_MODE is misconfigured.
    this.assertAuthMode();
  }

  /**
   * Validate LEDGER_AUTH_MODE. Only keycloak is supported — a missing/typo'd
   * value is a config bug and failing loud here is far safer than silently
   * operating with no auth.
   */
  private assertAuthMode(): void {
    const m = (this.config.get<string>('LEDGER_AUTH_MODE') ?? '')
      .trim()
      .toLowerCase();
    if (m !== 'keycloak') {
      throw new Error(
        `LEDGER_AUTH_MODE="${m}" is not supported. Set LEDGER_AUTH_MODE=keycloak.`,
      );
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.keycloak);
  }

  /**
   * Base headers for every Splice Validator API request.
   * Includes Host override required by nginx server_name routing on VPS 1.
   */
  private baseHeaders(
    extraHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.hostHeader) headers['Host'] = this.hostHeader;
    return headers;
  }

  /** Admin JWT token for Splice Validator API operations.
   *  Keycloak client_credentials (validator-app-backend). */
  private async adminToken(): Promise<string> {
    if (!this.keycloak) {
      throw new Error(
        'KeycloakTokenService is not injected in SpliceValidatorService. ' +
          'Ensure it is registered in CantonModule and LEDGER_AUTH_MODE=keycloak.',
      );
    }
    return this.keycloak.getAdminLedgerToken();
  }

  private authHeadersForToken(
    token: string,
    json = false,
  ): Record<string, string> {
    const extra: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (json) extra['Content-Type'] = 'application/json';
    return this.baseHeaders(extra);
  }

  /** Auth headers (Authorization + optional Host override). */
  private async authHeaders(): Promise<Record<string, string>> {
    return this.authHeadersForToken(await this.adminToken());
  }

  /**
   * Auth + Content-Type headers.
   *
   * Without a subject → admin token (Keycloak operator). WITH a subject this
   * would require a per-user wallet JWT, which does not exist in keycloak
   * (operator) mode — the backend acts as operator for every party. We fail
   * loud here so any per-user call-site (createTransferOffer-as-user,
   * acceptOfferViaWallet, etc.) surfaces immediately instead of producing a
   * 401 from the validator.
   */
  private async jsonAuthHeaders(
    subject?: string,
  ): Promise<Record<string, string>> {
    if (!subject) {
      return this.authHeadersForToken(await this.adminToken(), true);
    }
    // In keycloak (operator) mode the backend acts as operator for every
    // party — there is no per-user Splice wallet token. Throw so any
    // per-user call-site surfaces immediately instead of producing a 401.
    throw new Error(
      `Per-user wallet auth (username=${subject}) is not available in keycloak mode. ` +
        'Migrate this call-site to the Ledger API (CIP-0056). ' +
        'See migration doc §3 (CanQuest-Fix-03-Keycloak-Migration.md).',
    );
  }

  /**
   * True when wallet/user-status accepts JWT for this Splice username.
   *
   * In Keycloak (operator) mode the per-user wallet JWT does not exist — the
   * backend acts as operator for every party. We answer `true` so existing
   * onboarding flows proceed; the operator's Keycloak token authorizes the
   * admin wallet endpoints they actually need.
   */
  // username is part of the public interface; unused in keycloak operator mode.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canAccessWalletAs(username: string): Promise<boolean> {
    // In keycloak mode every onboarded user is operator-authorized.
    return Promise.resolve(this.isConfigured);
  }

  /** Usernames registered in Splice (GET /admin/users). */
  async listSpliceUsernames(): Promise<string[]> {
    if (!this.isConfigured) return [];
    try {
      const res = await fetch(`${this.baseUrl}/api/validator/v0/admin/users`, {
        headers: await this.authHeaders(),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { usernames?: string[] };
      return data.usernames ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Map a Canton party ID to the Splice wallet username that can act on-chain.
   * Party hint (before ::) is not always the registered Splice name.
   */
  async resolveWalletUsernameForParty(partyId: string): Promise<string | null> {
    const normalized = normalizeCantonPartyId(partyId);
    if (!normalized) return null;

    const hint = spliceWalletUsernameFromParty(partyId);
    if (hint && (await this.canAccessWalletAs(hint))) {
      const walletParty = await this.getWalletPartyId(hint);
      if (!walletParty || cantonPartyIdsEqual(walletParty, normalized))
        return hint;
    }

    for (const name of await this.listSpliceUsernames()) {
      if (
        hint &&
        name.toLowerCase() === hint.toLowerCase() &&
        (await this.canAccessWalletAs(name))
      ) {
        return name;
      }
      const walletParty = await this.getWalletPartyId(name);
      if (
        walletParty &&
        cantonPartyIdsEqual(walletParty, normalized) &&
        (await this.canAccessWalletAs(name))
      ) {
        return name;
      }
      const adminParty = await this.getUserPartyId(name);
      if (
        adminParty &&
        cantonPartyIdsEqual(adminParty, normalized) &&
        (await this.canAccessWalletAs(name))
      ) {
        return name;
      }
    }

    return null;
  }

  /**
   * Ensure a username can call wallet APIs (onboard via Splice if missing).
   * Does not change the user's stored party ID when Splice would allocate a new one.
   */
  async ensureSpliceWalletUser(
    preferredUsername: string,
    expectedPartyId?: string,
  ): Promise<{ ok: boolean; username?: string; detail?: string }> {
    const normalized = expectedPartyId
      ? normalizeCantonPartyId(expectedPartyId)
      : null;

    const resolved = normalized
      ? await this.resolveWalletUsernameForParty(expectedPartyId!)
      : null;
    if (resolved) return { ok: true, username: resolved };

    if (await this.canAccessWalletAs(preferredUsername)) {
      return { ok: true, username: preferredUsername };
    }

    const createdPartyId = await this.createWalletUser(preferredUsername);
    if (createdPartyId) {
      if (normalized && !cantonPartyIdsEqual(createdPartyId, normalized)) {
        return {
          ok: false,
          detail:
            `Splice registered @${preferredUsername} with a different party than your wallet. ` +
            'Use Splice Wallet UI to create preapproval, or contact admin.',
        };
      }
      if (await this.canAccessWalletAs(preferredUsername)) {
        return { ok: true, username: preferredUsername };
      }
    }

    const spliceUsers = await this.listSpliceUsernames();
    const inList = spliceUsers.some(
      (u) => u.toLowerCase() === preferredUsername.toLowerCase(),
    );
    const walletUi = this.walletUiUrl;

    if (inList) {
      return {
        ok: false,
        detail:
          `@${preferredUsername} is listed in Splice but wallet API returns 403. ` +
          (walletUi
            ? `Open ${walletUi}, log in as @${preferredUsername}, and create preapproval there.`
            : 'Create preapproval via Splice Wallet UI.'),
      };
    }

    return {
      ok: false,
      detail:
        `Wallet @${preferredUsername} is not registered in Splice (Canton-only party). ` +
        'Your wallet was likely created while Splice was offline. ' +
        (walletUi
          ? `Open ${walletUi} to onboard, or delete and recreate the wallet when the Splice tunnel is active.`
          : 'Recreate the wallet when the Splice tunnel is active.'),
    };
  }

  /**
   * Create a Splice wallet user AND allocate their Canton Party ID in one call.
   *
   * POST /api/validator/v0/admin/users  { name: username }
   * → Response: { party_id: "username::fingerprint..." }
   *
   * This is the preferred method — it replaces the separate POST /v2/parties call
   * because the Splice validator handles party allocation internally.
   *
   * Returns the allocated Party ID string on success, null on failure.
   */
  async createWalletUser(username: string): Promise<string | null> {
    if (!this.isConfigured) {
      this.logger.warn(
        'CANTON_VALIDATOR_URL or CANTON_SPLICE_SECRET not set — skipping Splice wallet creation.',
      );
      return null;
    }

    const url = `${this.baseUrl}/api/validator/v0/admin/users`;
    const token = await this.adminToken();

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: await this.jsonAuthHeaders(),
        body: JSON.stringify({ name: username }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.logger.error(`Splice validator API unreachable: ${String(err)}`);
      return null;
    }

    const text = await res.text();

    if (res.status === 409) {
      const existingParty = await this.getUserPartyId(username);
      if (existingParty) {
        this.logger.warn(
          `Splice wallet username already exists: ${username} → ${existingParty}`,
        );
        return existingParty;
      }
      this.logger.warn(`Splice wallet username already taken: ${username}`);
      return null;
    }

    if (!res.ok) {
      this.logger.error(
        `Splice createWalletUser failed ${res.status}: ${text.slice(0, 300)}`,
      );
      return null;
    }

    let data: { party_id?: string };
    try {
      data = JSON.parse(text) as { party_id?: string };
    } catch {
      this.logger.error('Splice returned non-JSON response');
      return null;
    }

    const partyId = data.party_id;
    if (!partyId) {
      this.logger.error('Splice response missing party_id field');
      return null;
    }

    this.logger.log(`Splice wallet user created: ${username} → ${partyId}`);
    return partyId;
  }

  /**
   * Fetch a specific user's party ID from the Splice validator.
   * GET /api/validator/v0/admin/users/{username}
   */
  async getUserPartyId(username: string): Promise<string | null> {
    if (!this.isConfigured) return null;
    try {
      const res = await fetch(
        `${this.baseUrl}/api/validator/v0/admin/users/${encodeURIComponent(username)}`,
        {
          headers: await this.authHeaders(),
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { party_id?: string };
      return data.party_id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get a party's TransferPreapproval from the Splice validator.
   *
   * GET /api/validator/v0/admin/transfer-preapprovals/by-party/{partyId}
   *
   * Response: { transfer_preapproval: { contract: { payload: { expiresAt, provider, ... } } } }
   *   OR:     { error: "No TransferPreapproval found for party: ..." }
   *
   * A TransferPreapproval (Splice.AmuletRules:TransferPreapproval) allows any
   * party to send CC directly to the receiver without an offer/accept round-trip.
   * Users create this once via the Splice Wallet UI.
   */
  async getTransferPreapproval(
    partyId: string,
  ): Promise<{ expiresAt?: string; provider?: string } | null> {
    if (!this.isConfigured) return null;
    const normalized = normalizeCantonPartyId(partyId) ?? partyId.trim();
    try {
      const encoded = encodeURIComponent(normalized);
      const res = await fetch(
        `${this.baseUrl}/api/validator/v0/admin/transfer-preapprovals/by-party/${encoded}`,
        {
          headers: await this.authHeaders(),
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        transfer_preapproval?: {
          contract?: { payload?: { expiresAt?: string; provider?: string } };
        };
        error?: string;
      };
      if (data.error || !data.transfer_preapproval) return null;
      return {
        expiresAt: data.transfer_preapproval.contract?.payload?.expiresAt,
        provider: data.transfer_preapproval.contract?.payload?.provider,
      };
    } catch {
      return null;
    }
  }

  /** Returns true if the party has an active TransferPreapproval. */
  async hasTransferPreapproval(partyId: string): Promise<boolean> {
    return (await this.getTransferPreapproval(partyId)) !== null;
  }

  /**
   * Cancel (disable) TransferPreapproval for a party.
   * Tries admin API first, falls back to Ledger API if admin returns 401.
   */
  async cancelTransferPreapproval(
    partyId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured)
      return { ok: false, error: 'Splice not configured' };
    const normalized = normalizeCantonPartyId(partyId) ?? partyId.trim();
    const encoded = encodeURIComponent(normalized);

    // Try admin API first
    try {
      const res = await fetch(
        `${this.baseUrl}/api/validator/v0/admin/transfer-preapprovals/by-party/${encoded}`,
        {
          method: 'DELETE',
          headers: await this.authHeaders(),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (res.ok || res.status === 404) {
        return { ok: true };
      }
      // If 401/403, fall through to Ledger API approach
      if (res.status !== 401 && res.status !== 403) {
        const text = await res.text();
        return {
          ok: false,
          error: `Admin API ${res.status}: ${text.slice(0, 200)}`,
        };
      }
    } catch {
      /* fall through */
    }

    // Admin API failed with 401/403 — signal controller to use Ledger API
    return { ok: false, error: 'ADMIN_AUTH_FAILED' };
  }

  /**
   * Returns TransferPreapproval info as an array (for backward compat with controller).
   * Returns empty array if no preapproval exists.
   */
  async getTransferPreapprovals(
    partyId: string,
  ): Promise<{ expiresAt?: string; provider?: string }[]> {
    const tp = await this.getTransferPreapproval(partyId);
    return tp ? [tp] : [];
  }

  /**
   * Check if the Splice validator API is reachable.
   *
   * Uses GET /api/validator/v0/readyz — a dedicated health/readiness endpoint
   * that returns HTTP 200 when the validator is ready to accept requests.
   * Falls back to the admin users endpoint for older validator versions.
   *
   * Any HTTP response (including 4xx/5xx) from the network indicates the
   * server is reachable (i.e., the TCP connection succeeded).
   */
  async isReachable(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      // Try the readyz health endpoint first (preferred, less auth overhead)
      const healthRes = await fetch(`${this.baseUrl}/api/validator/v0/readyz`, {
        method: 'GET',
        headers: this.baseHeaders(),
        signal: AbortSignal.timeout(4_000),
      });
      // Any response (200, 401, 404, 503) means the server is reachable
      return true;
    } catch {
      // Connection refused / timeout — try authenticated endpoint as fallback
      try {
        await fetch(`${this.baseUrl}/api/validator/v0/admin/users`, {
          method: 'GET',
          headers: await this.authHeaders(),
          signal: AbortSignal.timeout(4_000),
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Send a CC reward from the validator wallet to a Splice user.
   *
   * Uses the Splice Wallet API (transfer offer flow):
   *   POST /api/validator/v0/wallet/transfer-offers  (as the validator admin user)
   *
   * Auth: sub = validator admin username, aud = CANTON_SPLICE_AUDIENCE
   *
   * The offer is created with a 7-day expiry. The receiver must accept it
   * (either manually via Splice Wallet UI, or automatically via acceptTransferOffer).
   *
   * Returns the offer_contract_id on success, null on failure.
   */
  async createTransferOffer(
    receiverPartyId: string,
    amountCc: number,
    description = 'CanQuest reward',
    trackingId = randomUUID(),
    /** Who is sending — defaults to the validator admin (for rewards). Pass user's username for user-to-user transfers. */
    senderUsername?: string,
  ): Promise<string | null> {
    if (!this.isConfigured) return null;

    const effectiveSender =
      senderUsername ??
      this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER') ??
      'administrator';

    // Resolve sender party ID
    const senderPartyId =
      (effectiveSender !== 'administrator'
        ? await this.getWalletPartyId(effectiveSender)
        : null) ??
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ??
      '';

    // Resolve operator/DSO party
    const dsoParty =
      this.config.get<string>('CANTON_DSO_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ||
      '';

    // Deadline: 7 days from now in ISO-8601 (for transferBefore)
    const transferBefore = new Date(
      Date.now() + 7 * 24 * 3_600_000,
    ).toISOString();

    // expires_at must be in MICROSECONDS (Unix timestamp × 1_000_000).
    const nowMicros = BigInt(Date.now()) * 1_000n;
    const sevenDaysMicros = 7n * 24n * 3_600n * 1_000_000n;
    const expiresAtMicros = nowMicros + sevenDaysMicros;

    const url = `${this.baseUrl}/api/validator/v0/wallet/transfer-offers`;

    try {
      const body = {
        // Legacy Splice REST fields (backward compatible)
        receiver_party_id: receiverPartyId,
        amount: amountCc.toString(),
        description,
        expires_at: Number(expiresAtMicros),
        tracking_id: trackingId,

        // TwoStepTransfer fields per Splice.Amulet.TwoStepTransfer DAML type
        dso: dsoParty,
        sender: senderPartyId,
        receiver: receiverPartyId,
        lockContext: description,
        transferBefore,
        transferBeforeDeadline: 'Transfer expiry',
        provider: dsoParty,
        allowFeaturing: false,
      };

      this.logger.log(
        `TransferOffer TwoStepTransfer: ${senderPartyId.split('::')[0]} → ${receiverPartyId.split('::')[0]} ${amountCc} CC`,
      );

      const res = await fetch(url, {
        method: 'POST',
        headers: await this.jsonAuthHeaders(effectiveSender),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(
          `createTransferOffer ${res.status}: ${text.slice(0, 300)}`,
        );
        return null;
      }

      const data = JSON.parse(text) as { offer_contract_id?: string };
      const contractId = data.offer_contract_id ?? null;
      if (contractId) {
        this.logger.log(
          `TransferOffer created: ${amountCc} CC → ${receiverPartyId.split('::')[0]} (${contractId.slice(0, 20)}...)`,
        );
      }
      return contractId;
    } catch (err) {
      this.logger.error(`createTransferOffer failed: ${String(err)}`);
      return null;
    }
  }

  /**
   * Party ID bound to a Splice wallet user (authoritative for treasury / fee recipient).
   * GET /api/validator/v0/wallet/user-status
   */
  async getWalletPartyId(username: string): Promise<string | null> {
    if (!this.isConfigured) return null;
    try {
      const res = await fetch(
        `${this.baseUrl}/api/validator/v0/wallet/user-status`,
        {
          headers: await this.authHeaders(),
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) return null;
        return null;
      }
      const data = (await res.json()) as { party_id?: string };
      return data.party_id?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve treasury wallet for platform / claim fees (same rules as Send CC).
   * Prefer CANTON_FEE_RECIPIENT_PARTY_ID → CANTON_FEE_PARTY_ID → Splice user-status party.
   * Fee TIDAK PERNAH dikirim ke validator lagi — TERISOLASI ke canquest-fee.
   */
  async resolveTreasuryFeeTarget(): Promise<{
    treasuryPartyId: string;
    treasuryAcceptUsername: string;
  } | null> {
    const treasuryAcceptUsername =
      this.config.get<string>('CANTON_FEE_ACCEPT_USERNAME')?.trim() ||
      this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER')?.trim() ||
      'administrator';

    let treasuryPartyId =
      this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
      this.config.get<string>('CANTON_FEE_PARTY_ID')?.trim() ||
      null;

    if (!treasuryPartyId) {
      const validatorPartyId = this.config
        .get<string>('CANTON_VALIDATOR_PARTY_ID')
        ?.trim();
      if (!validatorPartyId) return null;
      treasuryPartyId = validatorPartyId;
      this.logger.warn(
        'CANTON_FEE_RECIPIENT_PARTY_ID & CANTON_FEE_PARTY_ID both unset — fallback to CANTON_VALIDATOR_PARTY_ID (NOT recommended for mainnet)',
      );
    }

    const walletParty = await this.getWalletPartyId(treasuryAcceptUsername);
    if (walletParty && walletParty !== treasuryPartyId) {
      this.logger.warn(
        `Fee party mismatch: .env treasury=${treasuryPartyId.split('::')[0]} but Splice user ${treasuryAcceptUsername} → ${walletParty.split('::')[0]}. Using wallet party.`,
      );
      treasuryPartyId = walletParty;
    } else if (
      !this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() &&
      !this.config.get<string>('CANTON_FEE_PARTY_ID')?.trim() &&
      walletParty
    ) {
      treasuryPartyId = walletParty;
    }

    return { treasuryPartyId, treasuryAcceptUsername };
  }

  /**
   * FCFS / invite claim fee: user → CANTON_VALIDATOR_PARTY_ID (your node validator wallet).
   * Uses CIP-0056 collectPlatformFee (executeTransferFactoryTransfer).
   * Reward must only be sent after this returns collected=true.
   */
  async collectClaimFeeToValidatorParty(params: {
    senderPartyId: string; // ← BARU: party user yang bayar fee
    senderUsername: string;
    feeCc: number;
    description: string;
    validatorPartyId: string;
  }): Promise<{
    collected: boolean;
    ledgerTxId?: string;
    method?: string;
    error?: string;
    validatorPartyId?: string;
  }> {
    const validatorPartyId = params.validatorPartyId.trim();
    if (!validatorPartyId) {
      return {
        collected: false,
        error: 'CANTON_VALIDATOR_PARTY_ID is not set',
      };
    }

    const validatorLabel = validatorPartyId.split('::')[0];
    this.logger.log(
      `Claim fee step 1: @${params.senderUsername} → ${validatorLabel} (${params.feeCc} CC)`,
    );

    const result = await this.collectPlatformFee({
      senderPartyId: params.senderPartyId, // ← user yang bayar fee
      senderUsername: params.senderUsername,
      feeCc: params.feeCc,
      description: params.description,
      treasuryPartyId: validatorPartyId,
    });

    if (result.collected) {
      this.logger.log(
        `Claim fee step 1 OK: ${params.feeCc} CC on ${validatorLabel} via ${result.method ?? 'unknown'}`,
      );
    }

    return {
      collected: result.collected,
      ledgerTxId: result.ledgerTxId,
      method: result.method,
      error: result.error,
      validatorPartyId,
    };
  }

  /**
   * Collect platform fee via CIP-0056 TransferFactory (replaces Splice REST preapproval/offer flow).
   * Uses executeTransferFactoryTransfer (direct or offer) + acceptTransferInstruction if needed.
   * Non-blocking: returns collected=false on error, caller decides whether to proceed.
   */
  async collectPlatformFee(params: {
    senderPartyId: string; // ← BARU: party user yang bayar fee
    senderUsername?: string; // untuk logging
    feeCc: number;
    description: string;
    treasuryPartyId?: string;
    treasuryAcceptUsername?: string; // backward compat, diabaikan
    strictBalanceVerify?: boolean; // backward compat, diabaikan
  }): Promise<{
    collected: boolean;
    ledgerTxId?: string;
    method?: string;
    error?: string;
    treasuryPartyId?: string;
  }> {
    const { senderPartyId, feeCc, description } = params;
    const senderLabel = params.senderUsername || senderPartyId.split('::')[0];

    const resolved = params.treasuryPartyId
      ? {
          treasuryPartyId: params.treasuryPartyId,
          treasuryAcceptUsername:
            params.treasuryAcceptUsername ?? 'administrator',
        }
      : {
          treasuryPartyId:
            this.config.get<string>('CANTON_FEE_RECIPIENT_PARTY_ID')?.trim() ||
            this.config.get<string>('CANTON_VALIDATOR_PARTY_ID')?.trim() ||
            '',
          treasuryAcceptUsername: 'administrator',
        };

    if (!resolved?.treasuryPartyId) {
      return {
        collected: false,
        error: 'Treasury / validator party not configured',
      };
    }

    const { treasuryPartyId } = resolved;
    const treasuryLabel = treasuryPartyId.split('::')[0];

    if (!this.ledger) {
      this.logger.error(
        'CantonLedgerService not injected — cannot execute CIP-0056 fee transfer',
      );
      return {
        collected: false,
        error: 'CantonLedgerService not available',
        treasuryPartyId,
      };
    }

    // ── CIP-0056 fee transfer (non-blocking, actAs=senderPartyId) ───
    try {
      const feeResult = await this.ledger.executeTransferFactoryTransfer({
        senderPartyId, // ← user yang BAYAR fee (claimer)
        receiverPartyId: treasuryPartyId,
        amountCc: feeCc,
        description,
      });

      if (feeResult.ok && feeResult.transferKind === 'direct') {
        this.logger.log(
          `Platform fee ${feeCc} CC via CIP-0056 direct → ${treasuryLabel} (from ${senderLabel})`,
        );
        return {
          collected: true,
          ledgerTxId: feeResult.updateId ?? undefined,
          method: 'cip56_direct',
          treasuryPartyId,
        };
      }

      if (
        feeResult.ok &&
        feeResult.transferKind === 'offer' &&
        feeResult.transferInstructionCid
      ) {
        const acceptR = await this.ledger.acceptTransferInstruction(
          feeResult.transferInstructionCid,
          treasuryPartyId,
        );
        if (acceptR.ok) {
          this.logger.log(
            `Platform fee ${feeCc} CC via CIP-0056 offer-accept → ${treasuryLabel} (from ${senderLabel})`,
          );
          return {
            collected: true,
            ledgerTxId: acceptR.updateId ?? feeResult.updateId ?? undefined,
            method: 'cip56_offer_accept',
            treasuryPartyId,
          };
        }
        this.logger.warn(
          `Fee offer accept failed for ${treasuryLabel} — transfer proceeds without fee`,
        );
      }

      this.logger.warn(
        `Fee NOT collected (transferKind=${feeResult.transferKind}, ok=${feeResult.ok}). Proceeding without fee.`,
      );
      return {
        collected: false,
        error: feeResult.error ?? 'CIP-0056 fee gagal',
        treasuryPartyId,
      };
    } catch (feeErr) {
      this.logger.warn(`Fee collect error (non-blocking): ${String(feeErr)}`);
      return { collected: false, error: String(feeErr), treasuryPartyId };
    }
  }

  /** Read validator/treasury wallet balance with short retries (Splice API can lag). */
  private async readTreasuryBalanceWithRetry(
    username: string,
    attempts = 4,
  ): Promise<number | null> {
    for (let i = 0; i < attempts; i++) {
      const bal = await this.getUserBalance(username);
      if (bal !== null) return bal;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    return null;
  }

  /** Confirm fee actually landed in the treasury Splice wallet (not just HTTP 200). */
  private async verifyTreasuryFeeCredit(params: {
    treasuryAcceptUsername: string;
    feeCc: number;
    balanceBefore: number | null;
    /** When true, fail if balance cannot be read or did not increase. */
    strict?: boolean;
  }): Promise<boolean> {
    if (params.balanceBefore === null) {
      if (params.strict) {
        this.logger.error(
          'Treasury fee verify failed: could not read balance before fee',
        );
        return false;
      }
      return true;
    }
    await new Promise((r) => setTimeout(r, 2500));
    const balanceAfter = await this.readTreasuryBalanceWithRetry(
      params.treasuryAcceptUsername,
    );
    if (balanceAfter === null) {
      if (params.strict) {
        this.logger.error(
          'Treasury fee verify failed: could not read balance after fee',
        );
        return false;
      }
      return true;
    }
    const minExpected = params.balanceBefore + params.feeCc - 0.000_001;
    if (balanceAfter + 0.000_001 < minExpected) {
      this.logger.error(
        `Treasury fee verify failed: before=${params.balanceBefore} after=${balanceAfter} expected>=${minExpected}`,
      );
      return false;
    }
    return true;
  }

  /**
   * Get a user's CC balance from the Splice Wallet API.
   * GET /api/validator/v0/wallet/balance  (as the user)
   *
   * In Keycloak (operator) mode there is no per-user wallet JWT, so this REST
   * endpoint is unreachable. Callers should read balance from the DB
   * (BALANCE_READ_FROM_DB=true) — CcInboundSyncService keeps it in sync via the
   * Ledger API (getLedgerBalance, Keycloak admin token). Returning null here
   * makes the DB path authoritative.
   */
  // username is part of the public interface; unused in keycloak operator mode.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getUserBalance(username: string): Promise<number | null> {
    // No per-user wallet JWT in keycloak mode — DB is authoritative.
    return Promise.resolve(null);
  }

  /**
   * List open transfer offers for a user (incoming + outgoing).
   * GET /api/validator/v0/wallet/transfer-offers  (as the user)
   *
   * In Keycloak (operator) mode the per-user wallet JWT is not available. The
   * caller (party.controller) falls back to CantonLedgerService
   * queryPendingOffers() (ACS query, operator readAs) — return [] here so that
   * path is taken.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars -- username is part of the public interface; unused in keycloak operator mode. */
  listTransferOffers(
    username: string,
  ): Promise<{ contractId: string; payload: unknown }[]> {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    // No per-user wallet JWT in keycloak mode — caller falls back to Ledger API.
    return Promise.resolve([]);
  }

  /**
   * Create a TransferPreapproval for a wallet user via the Splice Wallet API.
   *
   * CIP-56 compliance: A TransferPreapproval on-chain signals that the party
   * consents to receiving direct CC transfers. Without it, every incoming transfer
   * still requires an explicit offer/accept round-trip.
   *
   * POST /api/validator/v0/wallet/transfer-preapproval  (authenticated as the user)
   *
   * This is called automatically when a user creates their wallet so they are
   * immediately ready to receive CC transfers without any manual step.
   *
   * Returns true if created (or already exists), false on failure.
   */
  async createTransferPreapproval(
    username: string,
  ): Promise<{ ok: boolean; status?: number; detail?: string }> {
    if (!this.isConfigured) {
      return {
        ok: false,
        detail: 'CANTON_VALIDATOR_URL atau CANTON_SPLICE_SECRET belum di-set.',
      };
    }
    try {
      const res = await fetch(
        `${this.baseUrl}/api/validator/v0/wallet/transfer-preapproval`,
        {
          method: 'POST',
          headers: await this.jsonAuthHeaders(),
          body: '{}',
          signal: AbortSignal.timeout(15_000),
        },
      );
      const text = await res.text();

      if (res.ok || res.status === 409) {
        this.logger.log(
          `TransferPreapproval ${res.status === 409 ? 'already active' : 'created'} for @${username} (CIP-56)`,
        );
        return { ok: true, status: res.status };
      }

      let detail = text.slice(0, 300);
      if (res.status === 404) {
        detail =
          'Endpoint preapproval tidak ditemukan di validator (versi Splice?). Buat lewat Splice Wallet UI.';
      } else if (res.status === 401 || res.status === 403) {
        const spliceUsers = await this.listSpliceUsernames();
        const listed = spliceUsers.some(
          (u) => u.toLowerCase() === username.toLowerCase(),
        );
        detail = listed
          ? `@${username} ada di Splice tapi wallet API menolak (403). Buat preapproval lewat Splice Wallet UI.`
          : `@${username} belum terdaftar di Splice Wallet. Buat ulang wallet saat tunnel Splice aktif.`;
      }
      this.logger.warn(
        `createTransferPreapproval ${res.status} for @${username}: ${text.slice(0, 200)}`,
      );
      return { ok: false, status: res.status, detail };
    } catch (err) {
      const msg = String(err);
      this.logger.warn(
        `createTransferPreapproval error for @${username}: ${msg}`,
      );
      return {
        ok: false,
        detail:
          msg.includes('ECONNREFUSED') || msg.includes('fetch failed')
            ? 'Tidak bisa hubungi Splice. Jalankan SSH tunnel.'
            : msg,
      };
    }
  }

  /**
   * Accept a specific TransferOffer via the Splice Wallet API (as a given user).
   * Used to accept fee offers arriving in the validator/admin wallet.
   *
   * POST /api/validator/v0/wallet/transfer-offers/{contractId}/accept
   */
  async acceptOfferViaWallet(
    contractId: string,
    asUsername: string,
  ): Promise<boolean> {
    if (!this.isConfigured) return false;
    try {
      const encodedId = encodeURIComponent(contractId);
      const res = await fetch(
        `${this.baseUrl}/api/validator/v0/wallet/transfer-offers/${encodedId}/accept`,
        {
          method: 'POST',
          headers: await this.jsonAuthHeaders(asUsername),
          body: '{}',
          signal: AbortSignal.timeout(45_000),
        },
      );
      const text = await res.text();
      if (res.ok) {
        this.logger.log(
          `Offer accepted via Splice Wallet API: ${contractId.slice(0, 16)}…`,
        );
        return true;
      }
      this.logger.warn(
        `Splice Wallet accept failed ${res.status}: ${text.slice(0, 200)}`,
      );
      return false;
    } catch (err) {
      this.logger.warn(`acceptOfferViaWallet error: ${String(err)}`);
      return false;
    }
  }

  /** CIP-0056 reward send — delegasi ke CantonLedgerService.sendReward. */
  async sendReward(params: {
    senderPartyId?: string;
    receiverPartyId: string;
    amountCc: number;
    description: string;
  }) {
    return this.ledger.sendReward(params);
  }

  /**
   * Returns the Splice Wallet UI URL so users can create their own
   * TransferPreapproval (enables direct CC transfers without offer/accept).
   *
   * The wallet UI is served by the same nginx proxy as the validator API,
   * so we derive it from CANTON_VALIDATOR_URL.
   */
  get walletUiUrl(): string | null {
    return this.baseUrl ?? null;
  }
}
