import {
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Swap DTOs — symbol-based (OneSwap model).
 *
 * OneSwap identifikasi token via display symbol ('CC', 'USDCX', 'CBTC'),
 * BUKAN instrumentId+admin ganda seperti Cantex lama. InstrumentId+admin
 * di-resolve backend via OneSwap listTokens() saat transfer ledger.
 *
 * Amulet = CC (display symbol 'CC' memetakan ke instrument id 'Amulet').
 */

/** Ceiling defensif untuk amount swap (human-decimal). */
export const MAX_SWAP_AMOUNT = 1_000_000;

/** Request body POST /api/party/swap — execute swap. */
export class SwapDto {
  /** Symbol token yang dijual (slot atas), mis. 'CC' atau 'USDCX'. */
  @IsString()
  @MinLength(1, { message: 'from token is required.' })
  @MaxLength(32)
  from!: string;

  /** Symbol token yang dibeli (slot bawah). */
  @IsString()
  @MinLength(1, { message: 'to token is required.' })
  @MaxLength(32)
  to!: string;

  /** Jumlah `from` yang dijual (human-decimal, mis. 10 untuk 10 CC). */
  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(MAX_SWAP_AMOUNT, { message: 'Amount exceeds swap ceiling.' })
  amount!: number;

  /** Idempotency nonce — UUID baru per klik Swap (anti double-submit). */
  @IsString()
  @MinLength(8, { message: 'Idempotency nonce is required.' })
  @MaxLength(64)
  clientNonce!: string;
}

/** Request body POST /api/party/swap/quote — live quote preview. */
export class SwapQuoteDto {
  /** Symbol token yang dijual. */
  @IsString()
  @MinLength(1, { message: 'from token is required.' })
  @MaxLength(32)
  from!: string;

  /** Symbol token yang dibeli. */
  @IsString()
  @MinLength(1, { message: 'to token is required.' })
  @MaxLength(32)
  to!: string;

  /** Jumlah `from` (human-decimal). */
  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(MAX_SWAP_AMOUNT, { message: 'Amount exceeds swap ceiling.' })
  amount!: number;
}
