import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request body for POST /api/party/swap/quote — pair FLEKSIBEL.
 *
 * Frontend kirim sell/buy instrument langsung (token mana pun di slot atas
 * atau bawah). Tidak ada hardcode "direction CC↔token" — user bisa swap
 * token apa pun ke token apa pun selama ada pool AMM Cantex untuk pair itu.
 *
 * Amulet = CC (CanQuest currency). FE menandai via isCC dari pools response.
 */
export const MAX_SWAP_AMOUNT = 1_000_000;

export class SwapQuoteDto {
  /** Instrumen yang dijual (slot atas). */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sellInstrumentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  sellInstrumentAdmin!: string;

  /** Instrumen yang dibeli (slot bawah). */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  buyInstrumentId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  buyInstrumentAdmin!: string;

  /** Jumlah yang dijual (human decimal, bukan micro). */
  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(MAX_SWAP_AMOUNT, { message: 'Amount exceeds swap ceiling.' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  maxNetworkFee?: string;

  /** Optional flag FE: true bila sell = CC (untuk pengecekan saldo). */
  @IsOptional()
  @IsBoolean()
  sellIsCC?: boolean;
}
