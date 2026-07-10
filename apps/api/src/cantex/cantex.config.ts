/**
 * Config reader untuk Cantex DEX integration.
 *
 * Semua secret (operator/trading key) dibaca dari env di startup. Key TIDAK
 * boleh di-log atau dikirim ke client. File api-key Cantex (hasil authenticate)
 * disimpan di path dengan permission 600.
 */

const env = process.env;

function required(name: string): string {
  const v = env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `Cantex: env ${name} wajib di-set untuk swap feature. ` +
        `Lihat docs/SWAP_SETUP.md.`,
    );
  }
  return v.trim();
}

export interface CantexConfig {
  /** Feature flag — false = endpoint swap return 503. */
  enabled: boolean;
  /** Base URL Cantex API (mainnet: https://api.cantex.io). */
  apiBaseUrl: string;
  /** Hex Ed25519 private key operator (64 hex chars). */
  operatorKeyHex: string;
  /** Hex secp256k1 private key trading/intent (64 hex chars). */
  tradingKeyHex: string;
  /** Path file cache untuk api_key Cantex (optional). */
  apiKeyPath: string | null;
  /** Party id Cantex trading account shared (cantex::1220...). */
  tradingAccountParty: string;
  /** Instrument id CC di Cantex (Amulet). */
  ccInstrumentId: string;
  /** Admin party instrument CC. */
  ccInstrumentAdmin: string;
}

let cached: CantexConfig | null = null;

/**
 * Membaca config dari env. `requireKeys=false` (default untuk health/startup)
 * mengembalikan config parsial tanpa throw — client lazy-init hanya saat
 * `CANTEX_ENABLED=true`.
 */
export function getCantexConfig(requireKeys = false): CantexConfig {
  if (cached) return cached;
  const enabled = env.CANTEX_ENABLED === 'true';
  const cfg: CantexConfig = {
    enabled,
    apiBaseUrl: (env.CANTEX_API_BASE_URL ?? 'https://api.cantex.io').replace(
      /\/$/,
      '',
    ),
    operatorKeyHex: env.CANTEX_OPERATOR_KEY ?? '',
    tradingKeyHex: env.CANTEX_TRADING_KEY ?? '',
    apiKeyPath: env.CANTEX_API_KEY_PATH ?? null,
    tradingAccountParty:
      env.CANTEX_TRADING_ACCOUNT_PARTY ??
      'cantex::1220c6c1c6221fac767f94d553f99b7ff1b36c928971168e1b2a0477469c7b07264b',
    ccInstrumentId: env.CANTEX_CC_INSTRUMENT_ID ?? 'Amulet',
    ccInstrumentAdmin: env.CANTEX_CC_INSTRUMENT_ADMIN ?? '',
  };
  if (requireKeys && enabled) {
    required('CANTEX_OPERATOR_KEY');
    required('CANTEX_TRADING_KEY');
    if (!cfg.ccInstrumentAdmin) {
      throw new Error(
        'Cantex: CANTEX_CC_INSTRUMENT_ADMIN wajib di-set (didapat dari getPools() pertama kali).',
      );
    }
  }
  cached = cfg;
  return cfg;
}

/** True jika fitur swap diaktifkan via env (CANTEX_ENABLED=true). */
export function isCantexEnabled(): boolean {
  return getCantexConfig(false).enabled;
}
