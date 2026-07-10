import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request body for POST /api/party/swap/quote.
 *
 * Meminta live quote dari Cantex DEX. Dipakai frontend untuk preview
 * (output estimate, price impact, fees) SEBELUM user konfirmasi swap.
 *
 * Amount disini adalah human decimal CC (bukan micro), karena Cantex API
 * memakai decimal-string amounts.
 */
export const MAX_SWAP_CC = 1_000_000;

export class SwapQuoteDto {
  /** Arah swap. */
  @IsString()
  @MinLength(1)
  direction!: 'CC_TO_TOKEN' | 'TOKEN_TO_CC';

  /** Instrument id token target (bukan CC). Mis. "TokenX". */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  instrumentId!: string;

  /** Admin party token target. Mis. "DSO::1220...". */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  instrumentAdmin!: string;

  /**
   * Jumlah yang dijual (human decimal).
   * CC_TO_TOKEN: jumlah CC.
   * TOKEN_TO_CC: jumlah token.
   */
  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(MAX_SWAP_CC, { message: 'Amount exceeds swap ceiling.' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  maxNetworkFee?: string;
}
