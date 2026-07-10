/**
 * Type definitions untuk Cantex DEX API client.
 *
 * Di-port dari Python SDK `caviarnine/cantex_sdk` (`src/cantex_sdk/_sdk.py`).
 * Field names mengikuti response JSON asli (snake_case dari server) untuk
 * memudahkan tracing, tapi method signatures pakai camelCase (idiom NestJS).
 *
 * Catatan penting: Cantex memakai **decimal-string amounts** (bukan micro-units).
 * Semua amount dibawa sebagai `Decimal` (Prisma) / string di wire — konversi
 * micro-CC ↔ decimal hanya di service layer (CC side).
 */

import type { Decimal } from '@prisma/client/runtime/library';

/** Identitas token Cantex — pasangan (id, admin party). */
export interface InstrumentId {
  /** Instrument id, mis. "Amulet", "TokenX". */
  id: string;
  /** Admin party instrument, mis. "DSO::1220...". */
  admin: string;
}

/** Saldo satu token di Cantex trading account (GET /v1/account/info). */
export interface TokenBalance {
  instrument: InstrumentId;
  instrumentName: string;
  instrumentSymbol: string;
  unlockedAmount: Decimal;
  lockedAmount: Decimal;
  pendingDepositTransferCids: string[];
  pendingWithdrawTransferCids: string[];
  expiredAllocationCids: string[];
}

/** Info akun Cantex trading (GET /v1/account/info). */
export interface AccountInfo {
  address: string;
  userId: string;
  tokens: TokenBalance[];
}

/** Pool AMM Cantex (GET /v2/pools/info). */
export interface Pool {
  contractId: string;
  tokenA: InstrumentId;
  tokenB: InstrumentId;
}

/** Satu sisi quote (jumlah + instrumen). */
export interface QuoteLeg {
  amount: Decimal;
  instrument: InstrumentId;
}

/** Detail fee per quote. */
export interface QuoteFees {
  feePercentage: Decimal;
  amountAdmin: Decimal;
  amountLiquidity: Decimal;
  instrument: InstrumentId;
  networkFee: QuoteLeg;
}

/** Harga pool sebelum/sesudah trade + slippage. */
export interface QuotePrices {
  poolAfter: Decimal;
  poolBefore: Decimal;
  slippage: Decimal;
  trade: Decimal;
  tradeNoFees: Decimal;
}

/** Hasil POST /v2/pools/quote. */
export interface SwapQuote {
  sellAmount: Decimal;
  sellInstrument: InstrumentId;
  buyInstrument: InstrumentId;
  returned: QuoteLeg;
  poolSize: QuoteLeg;
  fees: QuoteFees;
  prices: QuotePrices;
  estimatedTimeSeconds: number;
}

/** Param untuk minta quote. */
export interface QuoteParams {
  /** Decimal-string, mis. "1.5". */
  sellAmount: string;
  sellInstrumentId: string;
  sellInstrumentAdmin: string;
  buyInstrumentId: string;
  buyInstrumentAdmin: string;
}

/** Param untuk submit swap (intent flow). */
export interface SwapParams {
  sellAmount: string;
  sellInstrument: InstrumentId;
  buyInstrument: InstrumentId;
  /** Network fee cap opsional (decimal-string). */
  maxNetworkFee?: string;
}

/** Hasil swapAndConfirm — diparse dari WS SwapExecuted event. */
export interface SwapResult {
  submissionId: string;
  inputAmount: Decimal;
  inputInstrument: InstrumentId;
  outputAmount: Decimal;
  outputInstrument: InstrumentId;
  adminFeeAmount: Decimal;
  liquidityFeeAmount: Decimal;
  executedAt?: Date;
}

/** WS event types (private channel). */
export type WsEventType =
  | 'Pool.SwapPending'
  | 'Pool.SwapFailed'
  | 'Pool.SwapExecuted'
  | 'Funding.DepositPending'
  | 'Funding.DepositConfirmed'
  | 'Funding.DepositRejected'
  | 'Funding.WithdrawalRequested'
  | 'Funding.WithdrawalCompleted'
  | 'Funding.WithdrawalFailed';

/**
 * Ticker update dari public WS channel (market.<TOKEN>-<TOKEN>.ticker).
 * Port dari Python SDK TickerEvent (lines 1024-1049).
 * event_type = "snapshot" (first frame) | "update" (subsequent).
 */
export interface TickerEvent {
  channel: string;
  market: string; // mis. "CC-USDCx"
  price: Decimal;
  priceTs: number; // timestamp data (data.ts)
  serverTs: number; // timestamp server (raw.ts)
  eventType: 'snapshot' | 'update';
}

/** Error hierarki (mirror Python SDK). */
export class CantexError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CantexError';
  }
}

export class CantexAuthError extends CantexError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CantexAuthError';
  }
}

export class CantexApiError extends CantexError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'CantexApiError';
  }
}

export class CantexTimeoutError extends CantexError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CantexTimeoutError';
  }
}
