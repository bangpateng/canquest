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
}
