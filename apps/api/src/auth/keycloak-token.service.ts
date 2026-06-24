import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Ambil token ledger dari KEYCLOAK.
 *
 * Mereplikasi cara script onboarding mengambil token:
 *   POST {KEYCLOAK_URL}/realms/{realm}/protocol/openid-connect/token
 *   grant_type=client_credentials, client_id, client_secret, scope=daml_ledger_api
 *
 * Body form-urlencoded, pakai `scope=daml_ledger_api`. Audience
 * (https://canton.network.global) sudah diset di Keycloak lewat scope,
 * jadi tidak perlu dikirim di sini.
 *
 * Token di-cache in-memory dan di-refresh sebelum expiry.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

@Injectable()
export class KeycloakTokenService {
  private readonly logger = new Logger(KeycloakTokenService.name);
  private readonly cache = new Map<string, CachedToken>();
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly SKEW_MS = 60_000;

  constructor(private readonly config: ConfigService) {}

  private req(name: string): string {
    const v = this.config.get<string>(name);
    if (!v) throw new Error(`Env var ${name} belum diset`);
    return v;
  }

  private get tokenUrl(): string {
    const base = this.req('KEYCLOAK_URL').replace(/\/$/, '');
    const realm = this.config.get<string>('KEYCLOAK_REALM') || 'canton';
    return `${base}/realms/${realm}/protocol/openid-connect/token`;
  }

  private get scope(): string {
    return (
      this.config.get<string>('LEDGER_API_AUTH_SCOPE') || 'daml_ledger_api'
    );
  }

  /** Token untuk operasi ledger sebagai admin/operator (validator-app-backend). */
  async getAdminLedgerToken(): Promise<string> {
    this.logger.debug(
      `getAdminLedgerToken: client_id=${this.req('LEDGER_CLIENT_ID')} ` +
        `url=${this.tokenUrl} scope=${this.scope}`,
    );
    return this.getToken(
      this.req('LEDGER_CLIENT_ID'),
      this.req('LEDGER_CLIENT_SECRET'),
    );
  }

  /**
   * Untuk SEKARANG reward pakai client yang sama (validator-app-backend).
   * Kalau temanmu nanti membuat client Keycloak terpisah khusus reward,
   * set REWARD_CLIENT_ID / REWARD_CLIENT_SECRET dan ini otomatis pakai itu.
   */
  async getRewardLedgerToken(): Promise<string> {
    const id =
      this.config.get<string>('REWARD_CLIENT_ID') ||
      this.req('LEDGER_CLIENT_ID');
    const secret =
      this.config.get<string>('REWARD_CLIENT_SECRET') ||
      this.req('LEDGER_CLIENT_SECRET');
    return this.getToken(id, secret);
  }

  async getToken(clientId: string, clientSecret: string): Promise<string> {
    const key = `${clientId}|${this.scope}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt - this.SKEW_MS > Date.now()) {
      return cached.accessToken;
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const p = this.fetchToken(clientId, clientSecret, key).finally(() =>
      this.inflight.delete(key),
    );
    this.inflight.set(key, p);
    return p;
  }

  private async fetchToken(
    clientId: string,
    clientSecret: string,
    key: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: this.scope,
    });

    // Timeout wajib: bila Keycloak hang (network black-hole), tanpa abort signal
    // promise tak pernah resolve dan `inflight` map menahannya selamanya →
    // mengunci permanen semua request token untuk identity ini.
    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak token request gagal (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.cache.set(key, {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });
    this.logger.debug(
      `Token Keycloak baru untuk ${key} (exp ${data.expires_in}s)`,
    );
    return data.access_token;
  }
}
