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
 * Request body for POST /api/party/send-cc.
 *
 * Replaces the previous inline `{ recipientUsername: string; amount: number }`
 * type so the global ValidationPipe (whitelist + forbidNonWhitelisted) actually
 * validates ranges and rejects malformed payloads before the controller runs.
 *
 * MAX_TRANSFER_CC is a defensive ceiling — combined with the DB balance check
 * in the controller it prevents an oversized `amount` from ever reaching the
 * ledger, and stops attackers from probing with absurd values.
 */
export const MAX_TRANSFER_CC = 1_000_000;

export class SendCcDto {
  @IsString()
  @MinLength(1, { message: 'Recipient is required.' })
  @MaxLength(256)
  recipientUsername!: string;

  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(MAX_TRANSFER_CC, { message: 'Amount exceeds the per-transfer ceiling.' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  memo?: string;

  /**
   * Kata sandi transaksi opsional (wallet password). Wajib hanya bila user telah
   * menetapkan satu di Settings — diverifikasi di awal handler sebelum eksekusi.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  txVerification?: string;

  /**
   * Idempotency nonce — UUID baru per klik Send. Dipakai untuk derive commandId
   * ledger yang DETERMINISTIK sehingga double-click / retry / multi-tab yang kirim
   * nonce sama di-dedup oleh Canton menjadi SATU transfer (bukan dua). Frontend
   * wajib generate crypto.randomUUID() sekali per submit attempt.
   */
  @IsString()
  @MinLength(8, { message: 'Idempotency nonce is required.' })
  @MaxLength(64)
  clientNonce!: string;
}
