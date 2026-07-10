/**
 * Config reader untuk Cantex DEX integration.
 *
 * PRINSIP: TIDAK PERNAH throw saat startup. Config dibaca apa adanya.
 * Validasi dilakukan LAZY (saat method CantexClient dipanggil) via
 * `validateCantexConfig()` — sehingga API tetap start walau config
 * Cantex belum lengkap, dan endpoint swap return 503 dengan pesan jelas.
 *
 * Semua secret (operator/trading key) dibaca dari env. Key TIDAK boleh
 * di-log atau dikirim ke client.
 */

const env = process.env;

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

/** Membaca config dari env. TIDAK PERNAH throw — aman dipanggil saat startup. */
export function getCantexConfig(): CantexConfig {
  if (cached) return cached;
  const cfg: CantexConfig = {
    enabled: env.CANTEX_ENABLED === 'true',
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
  cached = cfg;
  return cfg;
}

/**
 * Validasi config. Return pesan error (string) bila ada masalah,
 * atau null bila config lengkap & siap pakai. TIDAK throw.
 *
 * Dipanggil lazy oleh CantexClient.ensureReady() saat method dipanggil.
 */
export function validateCantexConfig(cfg?: CantexConfig): string | null {
  const c = cfg ?? getCantexConfig();
  if (!c.operatorKeyHex || !/^[0-9a-fA-F]{64}$/.test(c.operatorKeyHex)) {
    return 'CANTEX_OPERATOR_KEY belum di-set atau bukan 64 hex chars (Ed25519 private key).';
  }
  if (!c.tradingKeyHex || !/^[0-9a-fA-F]{64}$/.test(c.tradingKeyHex)) {
    return 'CANTEX_TRADING_KEY belum di-set atau bukan 64 hex chars (secp256k1 private key).';
  }
  // ccInstrumentAdmin boleh kosong di awal — akan diisi setelah getPools()
  // pertama. Endpoint getPools() tetap jalan (ccInstrument dari env lokal).
  return null;
}

/** True jika fitur swap diaktifkan via env (CANTEX_ENABLED=true). */
export function isCantexEnabled(): boolean {
  return getCantexConfig().enabled;
}
