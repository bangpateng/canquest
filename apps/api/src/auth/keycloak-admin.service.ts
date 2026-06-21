import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Keycloak Admin API client — untuk manajemen user di realm canton.
 *
 * Dipakai oleh flow onboarding wallet baru (Model A: tiap user punya party sendiri):
 *   1. Buat user di Keycloak -> dapat UUID (sub)
 *   2. UUID di-bridge ke Ledger API user (POST/PATCH /v2/users/{UUID})
 *   3. Grant rights ke party user sendiri
 *
 * Token admin diambil dari realm MASTER (admin-cli client) dengan password grant,
 * bukan dari realm canton (client_credentials). Ini diperlukan karena Admin API
 * hanya bisa diakses dengan token master realm.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private adminTokenCache: CachedToken | null = null;
  private adminTokenPromise: Promise<string> | null = null;
  private readonly SKEW_MS = 60_000;

  constructor(private readonly config: ConfigService) {}

  // ── helpers ──────────────────────────────────────────────────────

  private get baseUrl(): string {
    const v = this.config.get<string>('KEYCLOAK_URL');
    if (!v) throw new Error('KEYCLOAK_URL belum diset');
    return v.replace(/\/$/, '');
  }

  private get realm(): string {
    return this.config.get<string>('KEYCLOAK_REALM') || 'canton';
  }

  // ── Admin token (realm master, client admin-cli, grant password) ─

  /**
   * Dapatkan admin token dari KEYCLOAK realm master.
   * Cache in-memory dengan skew 60 detik (pola sama seperti keycloak-token.service.ts).
   */
  async getAdminToken(): Promise<string> {
    if (
      this.adminTokenCache &&
      this.adminTokenCache.expiresAt - this.SKEW_MS > Date.now()
    ) {
      return this.adminTokenCache.accessToken;
    }

    if (this.adminTokenPromise) return this.adminTokenPromise;

    this.adminTokenPromise = this.fetchAdminToken().finally(() => {
      this.adminTokenPromise = null;
    });
    return this.adminTokenPromise;
  }

  private async fetchAdminToken(): Promise<string> {
    const adminUser = this.config.get<string>('KEYCLOAK_ADMIN_USER');
    const adminPass = this.config.get<string>('KEYCLOAK_ADMIN_PASSWORD');
    if (!adminUser || !adminPass) {
      throw new Error(
        'KEYCLOAK_ADMIN_USER / KEYCLOAK_ADMIN_PASSWORD belum diset — ' +
        'diperlukan untuk manage user di Keycloak',
      );
    }

    const url = `${this.baseUrl}/realms/master/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: adminUser,
      password: adminPass,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      // Timeout wajib: getAdminToken() single-flight via adminTokenPromise —
      // satu promise stuck akan mengunci SEMUA operasi admin.
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Keycloak admin token request gagal (${res.status}): ${text.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.adminTokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    this.logger.debug(
      `Admin token Keycloak baru (exp ${data.expires_in}s)`,
    );
    return data.access_token;
  }

  // ── User CRUD ────────────────────────────────────────────────────

  /**
   * Buat user baru di realm canton.
   * POST /admin/realms/{realm}/users
   */
  async createUser(params: {
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  }): Promise<void> {
    const token = await this.getAdminToken();
    const url = `${this.baseUrl}/admin/realms/${this.realm}/users`;

    const body = {
      username: params.username,
      enabled: true,
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email,
      emailVerified: true,
      credentials: [
        {
          type: 'password',
          value: params.password,
          temporary: false,
        },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // Timeout: createUser melibatkan network call ke Keycloak; tanpa abort,
      // request hang akan memblokir flow onboarding user tanpa batas.
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 201) {
      this.logger.log(
        `Keycloak user created: ${params.username} (${params.email})`,
      );
      return;
    }

    if (res.status === 409) {
      this.logger.warn(
        `Keycloak user '${params.username}' already exists (409) — reusing existing user`,
      );
      return;
    }

    const text = await res.text();
    throw new Error(
      `Keycloak createUser gagal (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  /**
   * Ambil UUID (sub) user Keycloak berdasarkan username.
   * GET /admin/realms/{realm}/users?username={username}
   */
  async getUserId(username: string): Promise<string> {
    const token = await this.getAdminToken();
    const url = `${this.baseUrl}/admin/realms/${this.realm}/users?username=${encodeURIComponent(username)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // Timeout:.getUserId dipanggil tepat setelah createUser — tanpa abort,
      // onboarding bisa hang tanpa feedback ke user.
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Keycloak getUserId gagal (${res.status}): ${text.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as Array<{ id: string }>;
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error(
        `Keycloak user '${username}' tidak ditemukan setelah createUser`,
      );
    }

    return data[0].id;
  }

  /**
   * Gabungan: buat user + ambil UUID.
   * Return UUID (sub) yang bisa dipakai untuk bridge ke Ledger API.
   */
  async createUserAndGetId(params: {
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  }): Promise<string> {
    await this.createUser(params);
    return this.getUserId(params.username);
  }
}