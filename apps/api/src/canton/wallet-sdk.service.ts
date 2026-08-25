import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import dns from 'node:dns';

/**
 * CantonWalletSdkService — penyedia singleton @canton-network/wallet-sdk.
 *
 * SDK dipakai backend HANYA sebagai relay infrastruktur:
 *   - alokasi external party (topology generate + allocate dengan signature user)
 *   - interactive submission (prepare / execute) untuk M3
 *
 * Kunci private user TIDAK PERNAH melewati service ini — yang diterima hanya
 * public key dan signature hasil-sign di browser (arsitektur M0 terverifikasi).
 *
 * PENTING — ESM INTEROP: wallet-sdk adalah paket ESM. Import statis di build
 * CommonJS (nest build) di-compile jadi require() → "openapi_fetch.default
 * is not a function" di produksi (terbukti VPS 2026-08-25). Karena itu SDK
 * dimuat via dynamic import() SAAT RUNTIME — Node memuatnya sebagai ESM asli
 * dan interop benar. JANGAN kembalikan ke import statis.
 *
 * Auth: Keycloak client_credentials (client validator-app-backend), sama dengan
 * CantonLedgerService. Logger SDK di-redam (default-nya mencetak access token).
 *
 * Env tambahan:
 *   CANTON_DNS_OVERRIDES — opsional, format "host=ip,host=ip". Untuk lingkungan
 *   yang DNS-nya di-override ke proxy mati (mis. PC dev); di VPS tidak perlu.
 */
type WalletSdkModule = typeof import('@canton-network/wallet-sdk');
export type CantonSdk = Awaited<
  ReturnType<WalletSdkModule['SDK']['create']>
>;

@Injectable()
export class CantonWalletSdkService {
  private readonly logger = new Logger(CantonWalletSdkService.name);
  private sdk: CantonSdk | null = null;
  private initPromise: Promise<CantonSdk> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Pin dns.lookup per-proses (opsional, CANTON_DNS_OVERRIDES). Idempotent. */
  private applyDnsOverrides(): void {
    const raw = this.config.get<string>('CANTON_DNS_OVERRIDES');
    if (!raw) return;
    const overrides = new Map<string, string>();
    for (const pair of raw.split(',')) {
      const [host, ip] = pair.split('=').map((s) => s?.trim());
      if (host && ip) overrides.set(host, ip);
    }
    if (!overrides.size) return;
    const orig = dns.lookup.bind(dns);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dns as any).lookup = (hostname: string, options: any, callback?: any) => {
      let cb = callback;
      let opts = options;
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      const ip = overrides.get(hostname);
      return ip ? orig(ip, opts, cb) : orig(hostname, opts, cb);
    };
    this.logger.log(`DNS pin aktif untuk ${overrides.size} host (CANTON_DNS_OVERRIDES)`);
  }

  /** Instance SDK (lazy, sekali per proses). */
  getSdk(): Promise<CantonSdk> {
    if (this.sdk) return Promise.resolve(this.sdk);
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.applyDnsOverrides();

        // ESM INTEROP: dynamic import saat runtime — lihat catatan header file.
        const { SDK, CustomLogAdapter } = await import('@canton-network/wallet-sdk');

        // Logger redaksi: default SDK mencetak response (berisi access token).
        const quiet = new CustomLogAdapter((level: string, ctx: Record<string, unknown>, message?: string) => {
          if (level !== 'warn' && level !== 'error') return;
          const safe = { ...ctx };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (safe as any).response;
          this.logger.warn(
            `[sdk:${level}] ${message ?? ''} ${JSON.stringify(safe).slice(0, 160)}`,
          );
        });

        const primary =
          this.config.get<string>('LEDGER_API_URL')?.trim() || '';
        const fallback =
          this.config.get<string>('CANTON_JSON_API_URL')?.trim() || '';
        const keycloakUrl = this.config.get<string>('KEYCLOAK_URL');
        const realm = this.config.get<string>('KEYCLOAK_REALM');
        const clientId = this.config.get<string>('LEDGER_CLIENT_ID');
        const clientSecret = this.config.get<string>('LEDGER_CLIENT_SECRET');
        if ((!primary && !fallback) || !keycloakUrl || !realm || !clientId || !clientSecret) {
          throw new Error(
            'Konfigurasi SDK belum lengkap (LEDGER_API_URL/CANTON_JSON_API_URL + KEYCLOAK_URL/REALM + LEDGER_CLIENT_ID/SECRET)',
          );
        }

        const buildSdk = (url: string) =>
          SDK.create({
            auth: {
              method: 'client_credentials',
              configUrl: `${keycloakUrl}/realms/${realm}/.well-known/openid-configuration`,
              credentials: {
                clientId,
                clientSecret,
                audience:
                  this.config.get<string>('CANTON_LEDGER_API_AUDIENCE') ||
                  'https://canton.network.global',
                scope:
                  this.config.get<string>('LEDGER_API_AUTH_SCOPE') ||
                  'daml_ledger_api',
              },
            },
            ledgerClientUrl: url,
            logAdapter: quiet,
          });

        // Primary: gateway publik (LEDGER_API_URL). Kalau gagal (routing VPS
        // beda dgn PC dev), fallback ke jalur tunnel produksi lama
        // (CANTON_JSON_API_URL) yang terbukti dipakai seluruh dapp.
        let sdk: CantonSdk;
        try {
          if (!primary) throw new Error('no primary URL');
          sdk = await buildSdk(primary);
        } catch (errPrimary) {
          this.logger.warn(
            `SDK init via ${primary} gagal: ${String(errPrimary).slice(0, 180)}`,
          );
          if (!fallback || fallback === primary) {
            this.logger.error(
              `SDK init GAGAL total (primary=${primary || '-'} fallback=${fallback || '-'}): ${String(errPrimary).slice(0, 300)}`,
            );
            throw errPrimary;
          }
          this.logger.log(`SDK init retry via fallback ${fallback}…`);
          sdk = await buildSdk(fallback);
        }

        this.sdk = sdk;
        this.logger.log('Canton wallet-sdk siap (client_credentials).');
        return sdk;
      })();
    }
    return this.initPromise;
  }
}
