import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

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
 * Setup — SSH tunnel from VPS 2 to VPS 1:
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
 * Auth — hs-256-unsafe shared secret (devnet/testnet):
 *   CANTON_SPLICE_SECRET=unsafe
 *   CANTON_SPLICE_AUDIENCE=https://validator.example.com
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
  private readonly secret: string | null;
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

  constructor(private readonly config: ConfigService) {
    const raw = config.get<string>('CANTON_VALIDATOR_URL');
    this.baseUrl = raw ? raw.replace(/\/$/, '') : null;
    this.secret = config.get<string>('CANTON_SPLICE_SECRET') ?? null;
    this.hostHeader =
      config.get<string>('CANTON_VALIDATOR_HOST_HEADER') ?? 'wallet.localhost';
  }

  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.secret);
  }

  /**
   * Base headers for every Splice Validator API request.
   * Includes Host override required by nginx server_name routing on VPS 1.
   */
  private baseHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (this.hostHeader) headers['Host'] = this.hostHeader;
    return headers;
  }

  /** JWT token for admin operations — signed with the Splice hs-256-unsafe shared secret. */
  private adminToken(subject = 'ledger-api-user'): string {
    if (!this.secret) throw new Error('CANTON_SPLICE_SECRET is not set');
    const audience =
      this.config.get<string>('CANTON_SPLICE_AUDIENCE') ?? 'https://validator.example.com';
    return jwt.sign(
      { sub: subject, aud: audience },
      this.secret,
      { algorithm: 'HS256', expiresIn: '5m' },
    );
  }

  /** Auth headers (Authorization + optional Host override). */
  private authHeaders(subject?: string): Record<string, string> {
    return this.baseHeaders({
      Authorization: `Bearer ${this.adminToken(subject)}`,
    });
  }

  /** Auth + Content-Type headers. */
  private jsonAuthHeaders(subject?: string): Record<string, string> {
    return this.baseHeaders({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.adminToken(subject)}`,
    });
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
    const token = this.adminToken();

        let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.jsonAuthHeaders(),
        body: JSON.stringify({ name: username }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.logger.error(`Splice validator API unreachable: ${String(err)}`);
      return null;
    }

    const text = await res.text();

    if (res.status === 409) {
      this.logger.warn(`Splice wallet username already taken: ${username}`);
      return null;
    }

    if (!res.ok) {
      this.logger.error(`Splice createWalletUser failed ${res.status}: ${text.slice(0, 300)}`);
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
          headers: this.authHeaders(),
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
    try {
      const encoded = encodeURIComponent(partyId);
            const res = await fetch(
        `${this.baseUrl}/api/validator/v0/admin/transfer-preapprovals/by-party/${encoded}`,
        {
          headers: this.authHeaders(),
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
      const healthRes = await fetch(
        `${this.baseUrl}/api/validator/v0/readyz`,
        {
          method: 'GET',
          headers: this.baseHeaders(),
          signal: AbortSignal.timeout(4_000),
        },
      );
      // Any response (200, 401, 404, 503) means the server is reachable
      return true;
    } catch {
      // Connection refused / timeout — try authenticated endpoint as fallback
      try {
        await fetch(`${this.baseUrl}/api/validator/v0/admin/users`, {
          method: 'GET',
          headers: this.authHeaders(),
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

    const validatorAdminUsername =
      senderUsername ?? this.config.get<string>('CANTON_VALIDATOR_ADMIN_USER') ?? 'administrator';

        // expires_at must be in MICROSECONDS (Unix timestamp × 1_000_000).
    // Per Canton docs the timestamp is epoch-microseconds as a number.
    // We compute: (now_ms * 1000) + (7_days_in_microseconds)
    // Using BigInt throughout to avoid float precision loss at large values.
    const nowMicros = BigInt(Date.now()) * 1_000n;
    const sevenDaysMicros = 7n * 24n * 3_600n * 1_000_000n;
    const expiresAtMicros = nowMicros + sevenDaysMicros;

    const url = `${this.baseUrl}/api/validator/v0/wallet/transfer-offers`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.jsonAuthHeaders(validatorAdminUsername),
        body: JSON.stringify({
          receiver_party_id: receiverPartyId,
          amount: amountCc.toString(),
          description,
          // Convert BigInt to Number for JSON serialisation.
          // Safe up to ~9_007_199_254_740_991 microseconds (≈2285 AD).
          expires_at: Number(expiresAtMicros),
          tracking_id: trackingId,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(`createTransferOffer ${res.status}: ${text.slice(0, 300)}`);
        return null;
      }

      const data = JSON.parse(text) as { offer_contract_id?: string };
      const contractId = data.offer_contract_id ?? null;
      if (contractId) {
        this.logger.log(`TransferOffer created: ${amountCc} CC → ${receiverPartyId.split('::')[0]} (${contractId.slice(0, 20)}...)`);
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
      const res = await fetch(`${this.baseUrl}/api/validator/v0/wallet/user-status`, {
        headers: this.authHeaders(username),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { party_id?: string };
      return data.party_id?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * One-step CC send when receiver has TransferPreapproval (preferred for platform fees).
   * POST /api/validator/v0/wallet/transfer-preapproval/send  (as sender)
   */
  async sendViaTransferPreapproval(
    senderUsername: string,
    receiverPartyId: string,
    amountCc: number,
    description: string,
  ): Promise<{ ok: boolean; referenceId?: string; error?: string }> {
    if (!this.isConfigured) {
      return { ok: false, error: 'Splice not configured' };
    }
    const url = `${this.baseUrl}/api/validator/v0/wallet/transfer-preapproval/send`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.jsonAuthHeaders(senderUsername),
        body: JSON.stringify({
          receiver_party_id: receiverPartyId,
          amount: amountCc.toString(),
          description,
          deduplication_id: randomUUID(),
        }),
        signal: AbortSignal.timeout(45_000),
      });
      const text = await res.text();
      if (res.ok) {
        let referenceId: string | undefined;
        try {
          const data = JSON.parse(text) as {
            transfer_instruction_id?: string;
            update_id?: string;
            contract_id?: string;
          };
          referenceId =
            data.transfer_instruction_id ?? data.contract_id ?? data.update_id;
        } catch {
          referenceId = undefined;
        }
        this.logger.log(
          `Preapproval send: ${amountCc} CC from @${senderUsername} → ${receiverPartyId.split('::')[0]}`,
        );
        return { ok: true, referenceId };
      }
      return { ok: false, error: text.slice(0, 300) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /**
   * Collect platform fee into validator treasury (naxweb-validator-1 on TestNet).
   * Tries direct preapproval send first, then transfer-offer + treasury wallet accept.
   */
  async collectPlatformFee(params: {
    senderUsername: string;
    feeCc: number;
    description: string;
    treasuryPartyId: string;
    treasuryAcceptUsername: string;
  }): Promise<{ collected: boolean; ledgerTxId?: string; method?: string; error?: string }> {
    const { senderUsername, feeCc, description, treasuryPartyId, treasuryAcceptUsername } =
      params;

    const direct = await this.sendViaTransferPreapproval(
      senderUsername,
      treasuryPartyId,
      feeCc,
      description,
    );
    if (direct.ok) {
      return {
        collected: true,
        ledgerTxId: direct.referenceId,
        method: 'preapproval_send',
      };
    }

    const offerId = await this.createTransferOffer(
      treasuryPartyId,
      feeCc,
      description,
      undefined,
      senderUsername,
    );
    if (!offerId) {
      return {
        collected: false,
        error: direct.error ?? 'Failed to create fee transfer offer',
      };
    }

    const accepted = await this.acceptOfferViaWalletWithRetry(
      offerId,
      treasuryAcceptUsername,
      { attempts: 8, delayMs: 1500 },
    );
    if (accepted) {
      return { collected: true, ledgerTxId: offerId, method: 'transfer_offer' };
    }

    return {
      collected: false,
      ledgerTxId: offerId,
      error: `Fee offer created but treasury could not accept (${treasuryAcceptUsername})`,
    };
  }

  /**
   * Get a user's CC balance from the Splice Wallet API.
   * GET /api/validator/v0/wallet/balance  (as the user)
   */
    async getUserBalance(username: string): Promise<number | null> {
    if (!this.isConfigured) return null;
    try {
      const res = await fetch(`${this.baseUrl}/api/validator/v0/wallet/balance`, {
        headers: this.authHeaders(username),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { effective_unlocked_qty?: string };
      return data.effective_unlocked_qty ? parseFloat(data.effective_unlocked_qty) : 0;
    } catch {
      return null;
    }
  }

  /**
   * List open transfer offers for a user (incoming + outgoing).
   * GET /api/validator/v0/wallet/transfer-offers  (as the user)
   */
    async listTransferOffers(username: string): Promise<{ contractId: string; payload: unknown }[]> {
    if (!this.isConfigured) return [];
    try {
      const res = await fetch(`${this.baseUrl}/api/validator/v0/wallet/transfer-offers`, {
        headers: this.authHeaders(username),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        offers?: { contract_id?: string; payload?: unknown }[];
      };
      return (data.offers ?? []).map((o) => ({
        contractId: o.contract_id ?? '',
        payload: o.payload,
      }));
    } catch {
      return [];
    }
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
      return { ok: false, detail: 'CANTON_VALIDATOR_URL atau CANTON_SPLICE_SECRET belum di-set.' };
    }
    try {
      const res = await fetch(
        `${this.baseUrl}/api/validator/v0/wallet/transfer-preapproval`,
        {
          method: 'POST',
          headers: this.jsonAuthHeaders(username),
          body: '{}',
          signal: AbortSignal.timeout(15_000),
        },
      );
      const text = await res.text();

      if (res.ok) {
        this.logger.log(`TransferPreapproval created for @${username} (CIP-56)`);
        return { ok: true, status: res.status };
      }

      // 409 = already exists — that's fine, user is already CIP-56 compliant
      if (res.status === 409) {
        this.logger.log(`TransferPreapproval already active for @${username}`);
        return { ok: true, status: 409 };
      }

      let detail = text.slice(0, 300);
      if (res.status === 404) {
        detail =
          'Endpoint preapproval tidak ditemukan di validator (versi Splice?). Buat lewat Splice Wallet UI.';
      } else if (res.status === 401 || res.status === 403) {
        detail =
          'Auth Splice gagal — untuk DevNet set CANTON_SPLICE_AUDIENCE=https://validator.example.com';
      }
      this.logger.warn(`createTransferPreapproval ${res.status} for @${username}: ${text.slice(0, 200)}`);
      return { ok: false, status: res.status, detail };
    } catch (err) {
      const msg = String(err);
      this.logger.warn(`createTransferPreapproval error for @${username}: ${msg}`);
      return {
        ok: false,
        detail:
          msg.includes('ECONNREFUSED') || msg.includes('fetch failed')
            ? 'Tidak bisa hubungi Splice (port 8080). Jalankan SSH tunnel ke node validator.'
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
          headers: this.jsonAuthHeaders(asUsername),
          body: '{}',
          signal: AbortSignal.timeout(45_000),
        },
      );
      const text = await res.text();
      if (res.ok) {
        this.logger.log(`Offer accepted via Splice Wallet API: ${contractId.slice(0, 16)}…`);
        return true;
      }
      this.logger.warn(`Splice Wallet accept failed ${res.status}: ${text.slice(0, 200)}`);
      return false;
    } catch (err) {
      this.logger.warn(`acceptOfferViaWallet error: ${String(err)}`);
      return false;
    }
  }

  /** Accept with retries — fee offers may need a short delay before visible in wallet API. */
  async acceptOfferViaWalletWithRetry(
    contractId: string,
    asUsername: string,
    options?: { attempts?: number; delayMs?: number },
  ): Promise<boolean> {
    const attempts = options?.attempts ?? 5;
    const delayMs = options?.delayMs ?? 1500;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      if (await this.acceptOfferViaWallet(contractId, asUsername)) {
        if (i > 0) {
          this.logger.log(`Offer accepted on retry ${i + 1} as ${asUsername}`);
        }
        return true;
      }
    }
    return false;
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
