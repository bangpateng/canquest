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
    this.logger.debug(`Admin token Keycloak baru (exp ${data.expires_in}s)`);
    return data.access_token;
  }

  // ── User CRUD ────────────────────────────────────────────────────

  /**
   * Buat user baru di realm canton.
   * POST /admin/realms/{realm}/users
   *
   * Return UUID user bila berhasil create baru (diekstrak dari Location header).
   * Return null bila user sudah ada (409) — caller harus getUserId() utk dapat UUID.
   */
  async createUser(params: {
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  }): Promise<string | null> {
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
      // Keycloak 201 response punya Location header:
      //   /admin/realms/{realm}/users/{uuid}
      // Extract UUID langsung — lebih reliable dari search query (race-free).
      const location = res.headers.get('location') || '';
      const uuid = location.split('/').pop() || '';
      this.logger.log(
        `Keycloak user created: ${params.username} (${params.email}) uuid=${uuid.slice(0, 8)}...`,
      );
      return uuid || null;
    }

    if (res.status === 409) {
      this.logger.warn(
        `Keycloak user '${params.username}' already exists (409) — reusing existing user`,
      );
      return null;
    }

    const text = await res.text();
    throw new Error(
      `Keycloak createUser gagal (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  /**
   * Ambil UUID (sub) user Keycloak berdasarkan username.
   * GET /admin/realms/{realm}/users?username={username}
   *
   * Retry sampai 3x dengan delay 500ms utk handle Keycloak indexing lag
   * (user baru created tapi belum searchable via query).
   */
  async getUserId(username: string): Promise<string> {
    const token = await this.getAdminToken();
    const url = `${this.baseUrl}/admin/realms/${this.realm}/users?username=${encodeURIComponent(username)}`;

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
      if (Array.isArray(data) && data.length > 0) {
        return data[0].id;
      }

      // Indexing lag — user belum searchable. Retry bila belum attempt terakhir.
      if (attempt < MAX_RETRIES) {
        this.logger.debug(
          `Keycloak getUserId: '${username}' belum ter-index (attempt ${attempt}/${MAX_RETRIES}) — retry dalam ${RETRY_DELAY_MS}ms`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    throw new Error(
      `Keycloak user '${username}' tidak ditemukan setelah ${MAX_RETRIES}x retry (indexing lag)`,
    );
  }

  /**
   * Gabungan: buat user + ambil UUID.
   * Return UUID (sub) yang bisa dipakai untuk bridge ke Ledger API.
   *
   * Strategi (race-free):
   * 1. createUser() → baca UUID dari Location header 201 response (langsung).
   * 2. Fallback: bila header kosong (201) ATAU user sudah ada (409),
   *    panggil getUserId() dengan retry (handle indexing lag).
   */
  async createUserAndGetId(params: {
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    password: string;
  }): Promise<string> {
    const directUuid = await this.createUser(params);
    if (directUuid) return directUuid;
    // Fallback: user sudah ada (409) atau Location header kosong.
    return this.getUserId(params.username);
  }
}
