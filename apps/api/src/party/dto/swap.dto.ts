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
 * Request body for POST /api/party/swap — execute swap (pair FLEKSIBEL).
 *
 * Phase 1: endpoint return 503 (swap execution coming soon).
 * Phase 2: full execution.
 *
 * clientNonce wajib — idempotency key frontend (crypto.randomUUID()).
 */
export class SwapDto {
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

  /** Jumlah yang dijual (human decimal). */
  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(1_000_000, { message: 'Amount exceeds swap ceiling.' })
  amount!: number;

  /** Kata sandi transaksi opsional (wallet password). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  walletPassword?: string;

  /** True bila sell = CC (untuk custody routing di Phase 2). */
  @IsOptional()
  @IsBoolean()
  sellIsCC?: boolean;

  /** Idempotency nonce — UUID baru per klik Swap. */
  @IsString()
  @MinLength(8, { message: 'Idempotency nonce is required.' })
  @MaxLength(64)
  clientNonce!: string;
}
