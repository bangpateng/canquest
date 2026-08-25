import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * DTO onboarding wallet external (non-custodial) — M2.
 * Private key TIDAK ada di payload mana pun: hanya public key, signature,
 * dan partyHint (nama opaque buatan browser).
 */
export class PrepareExternalWalletDto {
  /** Public key Ed25519 user (hex 64 char) — dari key-manager browser. */
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, { message: 'publicKeyHex harus 64 karakter hex' })
  publicKeyHex!: string;

  /** Nama party opaque, mis. canquest-user-8f3k2a91b7 (dibuat client, RNG). */
  @IsString()
  @Matches(/^canquest-user-[0-9a-f]{6,32}$/, {
    message: 'partyHint harus canquest-user-<hex>',
  })
  partyHint!: string;

  /** M4: mode upgrade wallet custodial lama → external (saldo harus kosong). */
  @IsOptional()
  @IsBoolean()
  upgrade?: boolean;
}

export class CompleteExternalWalletDto {
  /** Signature Ed25519 atas multiHash (base64) — di-sign di browser user. */
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  signature!: string;

  /** M4: mode upgrade wallet custodial lama. */
  @IsOptional()
  @IsBoolean()
  upgrade?: boolean;

  /** Username dapp (opsional — diset kalau user belum punya). */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  walletInviteCode?: string;
}
