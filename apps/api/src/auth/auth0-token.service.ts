import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Auth0TokenService — fetches machine-to-machine (M2M) tokens from Auth0
 * using the OAuth 2.0 client_credentials grant.
 *
 * Two identities are supported:
 *   - dapp-admin  → general ledger operations (quest/operator)
 *   - dapp-reward → CC reward transfers (JOB_SEND_CC_REWARD, JOB_DISTRIBUTE_REWARD)
 *
 * Tokens are cached in-memory and refreshed 5 minutes before expiry.
 *
 * Required env vars (only when LEDGER_AUTH_MODE=auth0):
 *   AUTH_URL                  — Auth0 tenant URL, e.g. https://your-tenant.auth0.com
 *   LEDGER_API_AUTH_AUDIENCE  — Audience for the Canton Ledger API token
 *   DAPP_ADMIN_CLIENT_ID      — Client ID for dapp-admin identity
 *   DAPP_ADMIN_CLIENT_SECRET  — Client secret for dapp-admin identity
 *   DAPP_REWARD_CLIENT_ID     — Client ID for dapp-reward identity
 *   DAPP_REWARD_CLIENT_SECRET — Client secret for dapp-reward identity
 */
@Injectable()
export class Auth0TokenService {
  private readonly logger = new Logger(Auth0TokenService.name);

  private readonly authUrl: string;
  private readonly audience: string;

  // In-memory token cache per identity
  private readonly cache = new Map<
    'admin' | 'reward',
    { token: string; expiresAt: number }
  >();

  constructor(private readonly config: ConfigService) {
    this.authUrl = (config.get<string>('AUTH_URL') ?? '').replace(/\/$/, '');
    this.audience = config.get<string>('LEDGER_API_AUTH_AUDIENCE') ?? '';
  }

  /**
   * Returns a valid Auth0 M2M token for the dapp-admin identity.
   * Used for general ledger operations (quest/operator).
   */
  async getAdminLedgerToken(): Promise<string> {
    return this.getToken('admin');
  }

  /**
   * Returns a valid Auth0 M2M token for the dapp-reward identity.
   * Used exclusively for CC reward transfers.
   */
  async getRewardLedgerToken(): Promise<string> {
    return this.getToken('reward');
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async getToken(identity: 'admin' | 'reward'): Promise<string> {
    const cached = this.cache.get(identity);
    // Return cached token if still valid (with 5-minute buffer)
    if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
      return cached.token;
    }

    const token = await this.fetchToken(identity);
    return token;
  }

  private async fetchToken(identity: 'admin' | 'reward'): Promise<string> {
    const clientIdKey =
      identity === 'admin' ? 'DAPP_ADMIN_CLIENT_ID' : 'DAPP_REWARD_CLIENT_ID';
    const clientSecretKey =
      identity === 'admin'
        ? 'DAPP_ADMIN_CLIENT_SECRET'
        : 'DAPP_REWARD_CLIENT_SECRET';

    const clientId = this.config.get<string>(clientIdKey) ?? '';
    const clientSecret = this.config.get<string>(clientSecretKey) ?? '';

    if (!this.authUrl || !this.audience || !clientId || !clientSecret) {
      throw new Error(
        `Auth0TokenService: missing config for identity="${identity}". ` +
          `Check AUTH_URL, LEDGER_API_AUTH_AUDIENCE, ${clientIdKey}, ${clientSecretKey}`,
      );
    }

    const url = `${this.authUrl}/oauth/token`;

    this.logger.debug(`Fetching Auth0 M2M token for identity="${identity}"`);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          audience: this.audience,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new Error(
        `Auth0TokenService: fetch failed for identity="${identity}": ${String(err)}`,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Auth0TokenService: token endpoint returned ${res.status} for identity="${identity}": ${text.slice(0, 200)}`,
      );
    }

    let data: { access_token?: string; expires_in?: number };
    try {
      data = JSON.parse(text) as { access_token?: string; expires_in?: number };
    } catch {
      throw new Error(
        `Auth0TokenService: non-JSON response for identity="${identity}"`,
      );
    }

    if (!data.access_token) {
      throw new Error(
        `Auth0TokenService: no access_token in response for identity="${identity}"`,
      );
    }

    // Cache the token — expires_in is in seconds (default 3600 = 1 hour)
    const expiresIn = data.expires_in ?? 3600;
    this.cache.set(identity, {
      token: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    });

    this.logger.log(
      `Auth0 M2M token fetched for identity="${identity}" (expires in ${expiresIn}s)`,
    );

    return data.access_token;
  }
}
