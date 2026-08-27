/**
 * OneSwap types — tipe lokal untuk view ke frontend.
 *
 * Hanya error classes yang benar-benar dipakai controller yang di-re-export
 * dari @oneswap/sdk (sumber kebenaran, bukan diduplikasi) supaya selalu
 * sinkron dengan versi SDK. Type shapes SDK lainnya di-import langsung dari
 * @oneswap/sdk oleh konsumen yang membutuhkan.
 */

// Re-export error classes dari SDK (dipakai controller untuk catch bertingkat).
export {
  OneSwapError,
  NoDirectPoolError,
  AmbiguousPoolPairError,
} from '@oneswap/sdk';

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
  /** Slippage tolerance user (persen, mis. 0.5 = 0.5%). Default 0.5. */
  slippagePct?: number;
  /** M3b: true utk user external — leg input sudah di-sign browser (swap_input). */
  externalDepositDone?: boolean;
}

/** Hasil eksekusi swap — shape yang dikembalikan ke controller/frontend. */
export interface SwapExecResult {
  success: boolean;
  /** true = swap diterima dan diselesaikan di BACKGROUND (UI tidak menunggu). */
  pending?: boolean;
  /** 'CC_TO_TOKEN' | 'TOKEN_TO_CC' | '' (gagal). */
  direction: string;
  /** Jumlah output (token yang dibeli), bila sukses. */
  outputAmount?: string;
  /** SwapTransaction.id (DB), untuk korelasi. */
  swapId?: string;
  /** Pesan error/user-facing bila gagal. */
  message?: string;
}
