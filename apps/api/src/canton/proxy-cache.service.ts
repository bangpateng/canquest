import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeycloakTokenService } from '../auth/keycloak-token.service';

/**
 * ProxyCacheService
 *
 * Cache contract ID untuk WalletUserProxy + FeaturedAppRight supaya
 * CantonLedgerService bisa exercise proxy choices tanpa query ulang tiap
 * request. Di-refresh periodik (TTL) + on-demand.
 *
 * Splice WalletUserProxy (DAR: splice-util-featured-app-proxies):
 *   - Template: Splice.Util.FeaturedApp.WalletUserProxy:WalletUserProxy
 *   - Signatory: provider (app-canquest)
 *   - Choices:
 *       WalletUserProxy_TransferFactory_Transfer   (send CC/USDCx)
 *       WalletUserProxy_TransferInstruction_Accept (accept offer masuk)
 *       WalletUserProxy_TransferInstruction_Reject (reject offer masuk)
 *       WalletUserProxy_TransferInstruction_Withdraw (cancel offer keluar)
 *       WalletUserProxy_BatchTransfer              (send banyak token sekaligus)
 *
 * Official docs:
 *   https://docs.canton.network/sdks-tools/api-reference/splice-daml/splice-util-featured-app-proxies/splice-util-featuredapp-walletuserproxy
 *
 * Idiom query ACS sama dengan CantonLedgerService.queryAmuletHoldingsRaw:
 *   POST /v2/state/active-contracts
 *   body: { eventFormat: { filtersByParty, verbose: true }, activeAtOffset }
 *
 * Cache strategy:
 *   - Manual override via env (CANTON_PROXY_WUP_CID / CANTON_PROXY_FAR_CID)
 *     dipakai kalau diset (lebih cepat, skip query).
 *   - Kalau env kosong → query ACS party app-canquest, cari contract aktif.
 *   - TTL 10 menit (CANTON_PROXY_CACHE_TTL_MS). On-demand refresh kalau
 *     contractId kosong saat dibutuhkan.
 */
@Injectable()
export class ProxyCacheService {
  private readonly logger = new Logger(ProxyCacheService.name);
  private readonly baseUrl: string;
  private readonly appProviderPartyId: string;
  private readonly ledgerApiUser: string;
  private readonly ttlMs: number;

  /** packageId dari DAR splice-util-featured-app-proxies-1.2.4. */
  private readonly proxyPackageId: string;
  /** Template ID lengkap WalletUserProxy. */
  readonly wupTemplateId: string;
  /** Template ID FeaturedAppRight (V1, dari splice-api-featured-app-v1). */
  readonly farTemplateId: string;

  private cache: {
    walletUserProxyCid: string | null;
    walletUserProxyBlob: string | null; // createdEventBlob utk disclose ke user party
    featuredAppRightCid: string | null;
    featuredAppRightBlob: string | null;
    fetchedAt: number; // epoch ms
  } = {
    walletUserProxyCid: null,
    walletUserProxyBlob: null,
    featuredAppRightCid: null,
    featuredAppRightBlob: null,
    fetchedAt: 0,
  };

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly keycloak: KeycloakTokenService,
  ) {
    // baseUrl = LEDGER_API_URL (prod gateway) atau CANTON_JSON_API_URL (dev tunnel).
    const ledgerUrl =
      this.config.get<string>('LEDGER_API_URL') ||
      this.config.get<string>('CANTON_JSON_API_URL') ||
      'http://127.0.0.1:7575';
    this.baseUrl = ledgerUrl.replace(/\/$/, '');

    this.appProviderPartyId =
      this.config.get<string>('CANTON_APP_PROVIDER_PARTY_ID') ?? '';

    this.ledgerApiUser =
      this.config.get<string>('LEDGER_API_ADMIN_USER') ||
      this.config.get<string>('CANTON_LEDGER_API_USER') ||
      'ledger-api-user';

    // TTL cache — default 10 menit. Set CANTON_PROXY_CACHE_TTL_MS=0 untuk disable TTL.
    this.ttlMs = Number(
      this.config.get<string>('CANTON_PROXY_CACHE_TTL_MS') ?? 600_000,
    );

    // packageId + templateId. Override via env kalau DAR versi beda.
    this.proxyPackageId =
      this.config.get<string>('CANTON_PROXY_PACKAGE_ID') ??
      '88bcea6e9990bb2edb5301c042caa25c0594742665866f049f7bd67342d0865d';
    this.wupTemplateId = `${this.proxyPackageId}:Splice.Util.FeaturedApp.WalletUserProxy:WalletUserProxy`;
    // FeaturedAppRight V1 — packageId beda (splice-api-featured-app-v1-1.0.0).
    // Saat ini pakai '#splice-api-featured-app-v1:...' (dynamic resolution).
    // Kalau perlu hardcode, set CANTON_FAR_TEMPLATE_ID di env.
    this.farTemplateId =
      this.config.get<string>('CANTON_FAR_TEMPLATE_ID') ??
      '#splice-api-featured-app-v1:Splice.Api.FeaturedAppRightV1:FeaturedAppRight';
  }

  /** true kalau app provider party + keycloak terkonfigurasi. */
  get isEnabled(): boolean {
    return Boolean(this.appProviderPartyId && this.keycloak);
  }

  private async getLedgerToken(): Promise<string | null> {
    if (!this.keycloak) return null;
    try {
      return await this.keycloak.getAdminLedgerToken();
    } catch (err) {
      this.logger.error(`getLedgerToken: ${String(err)}`);
      return null;
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getLedgerToken();
    const base: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) base.Authorization = `Bearer ${token}`;
    return base;
  }

  private isCacheFresh(): boolean {
    if (this.ttlMs <= 0) return false;
    return (
      this.cache.fetchedAt > 0 &&
      Date.now() - this.cache.fetchedAt < this.ttlMs
    );
  }

  /**
   * Refresh cache: query ACS party app-canquest untuk WalletUserProxy +
   * FeaturedAppRight aktif. Idempoten, aman dipanggil berulang.
   */
  async refresh(): Promise<void> {
    if (!this.isEnabled) {
      this.logger.debug(
        'ProxyCache: CANTON_APP_PROVIDER_PARTY_ID / Keycloak belum siap — skip refresh.',
      );
      return;
    }

    // Ambil ledger-end offset (idiom app line ~2055).
    let offset = 0;
    try {
      const endRes = await fetch(`${this.baseUrl}/v2/state/ledger-end`, {
        headers: await this.authHeaders(),
        signal: AbortSignal.timeout(8_000),
      });
      if (endRes.ok) {
        const end = (await endRes.json()) as { offset?: number | string };
        offset = Number(end.offset ?? 0);
      }
    } catch (err) {
      this.logger.warn(`ProxyCache: ledger-end gagal (${String(err)})`);
    }

    // Query ACS WildcardFilter party app-canquest.
    const filtersByParty: Record<string, unknown> = {
      [this.appProviderPartyId]: {
        cumulative: [
          {
            identifierFilter: {
              WildcardFilter: { value: { includeCreatedEventBlob: false } },
            },
          },
        ],
      },
    };

    let wupCid: string | null = null;
    let wupBlob: string | null = null;
    let farCid: string | null = null;
    let farBlob: string | null = null;

    try {
      const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify({
          eventFormat: { filtersByParty, verbose: true },
          activeAtOffset: offset,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const t = await res.text();
        this.logger.warn(`ProxyCache ACS query ${res.status}: ${t.slice(0, 200)}`);
        return;
      }
      const arr = (await res.json()) as unknown[];
      if (!Array.isArray(arr)) return;

      for (const entry of arr) {
        if (!entry || typeof entry !== 'object') continue;
        const wrapper = entry as Record<string, unknown>;
        const active = wrapper.contractEntry as
          | Record<string, unknown>
          | undefined;
        const jsActive = active?.JsActiveContract as
          | Record<string, unknown>
          | undefined;
        const ev = (jsActive?.createdEvent ?? wrapper) as Record<
          string,
          unknown
        >;
        const tplId = typeof ev.templateId === 'string' ? ev.templateId : '';
        const cid = typeof ev.contractId === 'string' ? ev.contractId : null;
        if (!cid) continue;

        if (
          tplId.endsWith(':Splice.Util.FeaturedApp.WalletUserProxy:WalletUserProxy')
        ) {
          // Kalau ada multiple WUP, ambil yg pertama (atau favoritkan env override).
          if (!wupCid) {
            wupCid = cid;
            // createdEventBlob dari createdEvent — dipakai utk disclose WUP ke
            // user party (WUP signatory=provider, user butuh disclosure utk exercise).
            wupBlob =
              typeof ev.createdEventBlob === 'string'
                ? ev.createdEventBlob
                : null;
          }
        } else if (
          tplId.endsWith(':Splice.Api.FeaturedAppRightV1:FeaturedAppRight') ||
          tplId.endsWith(':Splice.Api.FeaturedAppRightV2:FeaturedAppRight')
        ) {
          if (!farCid) {
            farCid = cid;
            farBlob =
              typeof ev.createdEventBlob === 'string'
                ? ev.createdEventBlob
                : null;
          }
        }
      }
    } catch (err) {
      this.logger.warn(`ProxyCache ACS query error: ${String(err)}`);
      return;
    }

    this.cache = {
      // Env override menang (lebih cepat + deterministic).
      walletUserProxyCid:
        this.config.get<string>('CANTON_PROXY_WUP_CID') ?? wupCid,
      walletUserProxyBlob: wupBlob,
      featuredAppRightCid:
        this.config.get<string>('CANTON_PROXY_FAR_CID') ?? farCid,
      featuredAppRightBlob: farBlob,
      fetchedAt: Date.now(),
    };

    this.logger.log(
      `ProxyCache refreshed: WUP=${this.cache.walletUserProxyCid?.slice(0, 16) ?? 'none'}… ` +
        `FAR=${this.cache.featuredAppRightCid?.slice(0, 16) ?? 'none (transfer tanpa reward)'}`,
    );
  }

  /**
   * Ambil WalletUserProxy contractId. Refresh otomatis kalau cache basi/kosong.
   * Return null kalau tidak ada (caller harus fallback ke path lama).
   */
  async getWalletUserProxyCid(): Promise<string | null> {
    const override = this.config.get<string>('CANTON_PROXY_WUP_CID');
    if (override) return override; // env = source of truth

    if (!this.isCacheFresh() || !this.cache.walletUserProxyCid) {
      await this.refresh();
    }
    return this.cache.walletUserProxyCid;
  }

  /**
   * Ambil WalletUserProxy sebagai disclosed contract (utk dipass di
   * disclosedContracts command). Format: { templateId, contractId, createdEventBlob }.
   *
   * WAJIB dipass saat exercise proxy choice karena:
   *   - WUP signatory = provider (app-canquest)
   *   - Choice controller = user (end user party)
   *   - User BUKAN signatory → butuh disclosure utk lihat/exercise WUP.
   *
   * Tanpa disclosure → DAMAL reject CONTRACT_NOT_FOUND.
   */
  async getWalletUserProxyDisclosedContract(): Promise<{
    templateId: string;
    contractId: string;
    createdEventBlob: string;
  } | null> {
    if (!this.isCacheFresh() || !this.cache.walletUserProxyCid) {
      await this.refresh();
    }
    if (!this.cache.walletUserProxyCid || !this.cache.walletUserProxyBlob) {
      return null;
    }
    return {
      templateId: this.wupTemplateId,
      contractId: this.cache.walletUserProxyCid,
      createdEventBlob: this.cache.walletUserProxyBlob,
    };
  }

  /**
   * Ambil FeaturedAppRight sebagai disclosed contract (opsional — kalau ada).
   * Format sama dgn WUP disclosure.
   */
  async getFeaturedAppRightDisclosedContract(): Promise<{
    templateId: string;
    contractId: string;
    createdEventBlob: string;
  } | null> {
    if (!this.isCacheFresh()) {
      await this.refresh();
    }
    if (!this.cache.featuredAppRightCid || !this.cache.featuredAppRightBlob) {
      return null;
    }
    return {
      templateId: this.farTemplateId,
      contractId: this.cache.featuredAppRightCid,
      createdEventBlob: this.cache.featuredAppRightBlob,
    };
  }

  /**
   * Ambil FeaturedAppRight contractId (opsional — tanpa ini transfer via proxy
   * jalan tapi tidak earn CC rewards). Refresh otomatis.
   */
  async getFeaturedAppRightCid(): Promise<string | null> {
    const override = this.config.get<string>('CANTON_PROXY_FAR_CID');
    if (override) return override;

    if (!this.isCacheFresh()) {
      await this.refresh();
    }
    return this.cache.featuredAppRightCid;
  }

  /** Snapshot cache saat ini (untuk debug / health endpoint). */
  snapshot(): {
    walletUserProxyCid: string | null;
    featuredAppRightCid: string | null;
    fetchedAt: number;
    fresh: boolean;
  } {
    return {
      walletUserProxyCid: this.cache.walletUserProxyCid,
      featuredAppRightCid: this.cache.featuredAppRightCid,
      fetchedAt: this.cache.fetchedAt,
      fresh: this.isCacheFresh(),
    };
  }

  /** Invalidate cache — paksa refresh di panggilan berikutnya. */
  invalidate(): void {
    this.cache.fetchedAt = 0;
  }
}
