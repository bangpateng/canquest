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
 * Request body for POST /api/party/lock.
 *
 * termKey divalidasi terhadap map LOCK_TERM_OPTIONS di controller (validasi ketat:
 * harus salah satu key di daftar env, else 400). amountCc > 0.
 */
export const MAX_LOCK_CC = 1_000_000;

export class LockCcDto {
  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(MAX_LOCK_CC, { message: 'Amount exceeds the per-lock ceiling.' })
  amountCc!: number;

  @IsString()
  @MinLength(1, { message: 'termKey is required.' })
  @MaxLength(32)
  termKey!: string;

  /**
   * Kata sandi transaksi opsional (wallet password). Wajib hanya bila user telah
   * menetapkan satu — diverifikasi di awal handler.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  walletPassword?: string;
}
