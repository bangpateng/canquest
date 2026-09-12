import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Request body for POST /api/party/lock.
 *
 * MODE OPEN (2026-09-12): pilihan durasi DIHAPUS — `termKey` tidak lagi
 * diperlukan dan DIABAIKAN oleh controller (semua lock pakai term 'open',
 * tanpa batas waktu, masa tunggu unlock 2 menit). Field tetap ada supaya
 * client lama tidak 400.
 */
export const MAX_LOCK_CC = 1_000_000;

export class LockCcDto {
  @IsNumber()
  @Min(0.000001, { message: 'Amount must be greater than 0.' })
  @Max(MAX_LOCK_CC, { message: 'Amount exceeds the per-lock ceiling.' })
  amountCc!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  termKey?: string;
}
