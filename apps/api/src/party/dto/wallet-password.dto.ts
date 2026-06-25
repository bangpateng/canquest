import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Validasi dasar untuk kata sandi transaksi (wallet password).
 *
 * Aturan sama dengan password login di AuthService: panjang 8–64. `class-validator`
 * berjalan lewat global ValidationPipe (whitelist + forbidNonWhitelisted), jadi field
 * tak dikenal ditolak sebelum controller.
 */
export const MIN_WALLET_PASSWORD = 8;
export const MAX_WALLET_PASSWORD = 64;

/** Set atau ganti wallet password. currentPassword wajib bila user sudah punya satu. */
export class SetWalletPasswordDto {
  /** Wajib jika user sudah memiliki wallet password (verifikasi sebelum ganti). */
  @IsOptional()
  @IsString()
  @MinLength(MIN_WALLET_PASSWORD)
  @MaxLength(MAX_WALLET_PASSWORD)
  currentPassword?: string;

  @IsString()
  @MinLength(MIN_WALLET_PASSWORD, {
    message: `Wallet password must be at least ${MIN_WALLET_PASSWORD} characters.`,
  })
  @MaxLength(MAX_WALLET_PASSWORD)
  newPassword!: string;
}

/** Hapus wallet password — wajib verifikasi currentPassword terlebih dahulu. */
export class RemoveWalletPasswordDto {
  @IsString()
  @MinLength(MIN_WALLET_PASSWORD)
  @MaxLength(MAX_WALLET_PASSWORD)
  currentPassword!: string;
}

/**
 * Verifikasi wallet password untuk gate Send/Lock/Unlock. Dipakai endpoint pre-check
 * opsional di frontend. Untuk aksi sensitif sebenarnya, `walletPassword` dikirim sebagai
 * bagian dari DTO aksi (SendCcDto / LockCcDto / UnlockCcDto) — bukan endpoint ini.
 */
export class VerifyWalletPasswordDto {
  @IsString()
  @MinLength(1, { message: 'Wallet password is required.' })
  @MaxLength(MAX_WALLET_PASSWORD)
  walletPassword!: string;
}

/** Helper supaya pesan validasi password konsisten. */
export function walletPasswordRuleHint(): string {
  return `Use ${MIN_WALLET_PASSWORD}–${MAX_WALLET_PASSWORD} characters.`;
}
