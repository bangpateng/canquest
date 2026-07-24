/**
 * OneSwap configuration — env reader (lazy, never throws at startup).
 *
 * OneSwap = DEX di Canton Network dengan model "deposit-then-return":
 * backend createSwap → dapat depositParty → backend transfer input user ke
 * depositParty → OneSwap eksekusi atomik (DvP) → output balik ke senderParty
 * (= party user, karena backend yang jadi funder). User tidak perlu co-sign
 * DvP transaction, tidak perlu gas (networkFeeIn diambil dari input).
 *
 * Menggantikan modul Cantex lama (swap CC↔token via Cantex DEX intent flow).
 * OneSwap dipakai sebagai sumber tunggal: swap + daftar token/pool (untuk
 * pricing instrument list di CantonPriceService).
 *
 * Validation terjadi di OneSwapClient.ensureReady() (lazy), bukan saat import
 * config — supaya app tetap boot walau ONESWAP_API_KEY belum diset (mis. saat
 * dev lokal tanpa swap).
 */

export interface OneSwapConfig {
  /** API key dari dashboard OneSwap (sk_live_... / sk_test_...). Server-side only. */
  apiKey: string;
  /** 'mainnet' (default) | 'devnet'. */
  environment: 'mainnet' | 'devnet';
  /** HTTP timeout ms (default 30000). */
  timeoutMs: number;
  /** Minimum swap amount untuk CC leg (default 10 CC). */
  minAmountCc: number;
  /** Minimum swap amount untuk token non-CC leg (default 2.5). */
  minAmountToken: number;
  /** Reject swap bila price impact > ini (persen, default 5). */
  maxPriceImpactPct: number;
  /** Slippage tolerance default dalam basis points (default 200 = 2%). */
  defaultSlippageBps: number;
}

/**
 * Baca config dari env. Tidak throw — return dengan apiKey kosong bila belum
 * diset. `isOneSwapEnabled()` yang jadi source of truth enable/disable.
 */
export function getOneSwapConfig(): OneSwapConfig {
  return {
    apiKey: process.env.ONESWAP_API_KEY ?? '',
    environment:
      (process.env.ONESWAP_ENV as 'mainnet' | 'devnet') === 'devnet'
        ? 'devnet'
        : 'mainnet',
    timeoutMs: Number(process.env.ONESWAP_TIMEOUT ?? 30000),
    minAmountCc: Number(process.env.ONESWAP_MIN_AMOUNT_CC ?? 10),
    minAmountToken: Number(process.env.ONESWAP_MIN_AMOUNT_TOKEN ?? 2.5),
    maxPriceImpactPct: Number(process.env.ONESWAP_MAX_PRICE_IMPACT_PCT ?? 5),
    defaultSlippageBps: Number(process.env.ONESWAP_SLIPPAGE_BPS ?? 200),
  };
}

/**
 * Fitur swap aktif? True hanya bila ONESWAP_API_KEY diset (non-kosong).
 * Dipakai controller untuk gate endpoint swap (return 503 bila disabled),
 * menggantikan isCantexEnabled() lama.
 */
export function isOneSwapEnabled(): boolean {
  return Boolean((process.env.ONESWAP_API_KEY ?? '').trim());
}

/** Validasi config — throw bila API key belum diset. Dipanggil lazy dari client. */
export function validateOneSwapConfig(): OneSwapConfig {
  const cfg = getOneSwapConfig();
  if (!cfg.apiKey) {
    throw new Error(
      'ONESWAP_API_KEY is not set — cannot reach OneSwap. Set it in apps/api/.env',
    );
  }
  return cfg;
}
