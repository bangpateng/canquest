/**
 * OneSwap types — re-export SDK types + tipe lokal untuk view ke frontend.
 *
 * Error classes + type shapes diambil langsung dari @oneswap/sdk (sumber
 * kebenaran, bukan diduplikasi) supaya selalu sinkron dengan versi SDK.
 */

// Re-export error classes dari SDK (dipakai controller untuk catch bertingkat).
export {
  OneSwapError,
  AuthError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ConflictError,
  OpenSwapExistsError,
  NoDirectPoolError,
  AmbiguousPoolPairError,
  ServerError,
  NetworkError,
  TimeoutError,
} from '@oneswap/sdk';

// Re-export type shapes dari SDK (QuoteResult, Swap, Token, Pool, dst.)
export type {
  OneSwapConfig,
  OneSwapEnvironment,
  Swap,
  SwapStatus,
  CreateSwapArgs,
  WaitForSwapOptions,
  Token,
  Pool,
  PoolAsset,
  PoolDetail,
  PoolTicker,
  PoolSwap,
  Quote,
  QuoteResult,
  GetQuoteArgs,
  PoolPairCandidate,
} from '@oneswap/sdk';
export { isTerminal, TERMINAL_STATUSES } from '@oneswap/sdk';

/**
 * Parameter executeSwap — berbasis symbol (bukan instrumentId+admin ganda
 * seperti Cantex lama). OneSwap identifikasi token via symbol ('CC', 'USDCX').
 */
export interface ExecuteSwapParams {
  /** Symbol token yang dijual, mis. 'CC' atau 'USDCX'. */
  from: string;
  /** Symbol token yang dibeli. */
  to: string;
  /** Jumlah `from` (human-decimal, mis. 10 untuk 10 CC). */
  amount: number;
  /** Idempotency key dari client (UUID per klik Swap). */
  clientNonce: string;
}

/** Hasil eksekusi swap — shape yang dikembalikan ke controller/frontend. */
export interface SwapExecResult {
  success: boolean;
  /** 'CC_TO_TOKEN' | 'TOKEN_TO_CC' | '' (gagal). */
  direction: string;
  /** Jumlah output (token yang dibeli), bila sukses. */
  outputAmount?: string;
  /** SwapTransaction.id (DB), untuk korelasi. */
  swapId?: string;
  /** Pesan error/user-facing bila gagal. */
  message?: string;
}

/**
 * View quote untuk frontend — subset field Quote yang relevan untuk UI swap.
 * Frontend menampilkan: output estimate, price impact, breakdown fee.
 */
export interface QuoteView {
  /** Estimasi output (token yang dibeli). */
  amountOut: number;
  /** Price impact trade ini, persen. */
  priceImpactPct: number;
  /** Network fee dari input (gasless — user tidak butuh CC untuk gas). */
  networkFeeIn: number;
  /** Potongan platform dari pool fee (di input token). */
  platformFee: number;
  /** Potongan LP dari pool fee (di input token). */
  lpFee: number;
  /** Fee pool total (basis points), sebelum diskon. */
  swapFeeBps: number;
  /** Fee efektif (basis points) setelah diskon. */
  effFeeBps: number;
  /** Pool yang dipakai untuk quote (transparansi). */
  poolId: string;
  /** Symbol input. */
  inSym: string;
}
