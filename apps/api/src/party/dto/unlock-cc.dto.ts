import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Request body for POST /api/party/unlock.
 *
 * lockId opsional: jika kosong, backend pilih lock expiresAt<=now paling awal.
 */
export class UnlockCcDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  lockId?: string;

  /**
   * Kata sandi transaksi opsional (wallet password). Wajib hanya bila user telah
   * menetapkan satu — diverifikasi di awal handler.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  walletPassword?: string;
}
