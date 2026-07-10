import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Request body for POST /api/party/swap — execute swap CC ↔ token Cantex.
 *
 * Phase 1: endpoint return 503 (swap execution coming soon).
 * Phase 2: full execution (transfer CC leg + Cantex intent swap + WS confirm).
 *
 * clientNonce wajib — idempotency key frontend (crypto.randomUUID()),
 * dipakai untuk dedup retry/double-click (sama pattern dengan sendCc).
 */
export class SwapDto {
  @IsEnum(['CC_TO_TOKEN', 'TOKEN_TO_CC'])
  direction!: 'CC_TO_TOKEN' | 'TOKEN_TO_CC';

  /** Instrument id token target (bukan CC). */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  instrumentId!: string;

  /** Admin party token target. */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  instrumentAdmin!: string;

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

  /** Idempotency nonce — UUID baru per klik Swap. */
  @IsString()
  @MinLength(8, { message: 'Idempotency nonce is required.' })
  @MaxLength(64)
  clientNonce!: string;
}
