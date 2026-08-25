import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** DTO signing relay (M3). */
export class PrepareSignDto {
  /** Flow id, mis. "wallet_registration_accept", "send_cc". */
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  flow!: string;

  /** Parameter khusus flow (penerima, jumlah, dst. — tanpa rahasia apa pun). */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class ExecuteSignDto {
  /** Signature Ed25519 atas hash transaksi (base64) — di-sign di browser. */
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  signature!: string;
}
