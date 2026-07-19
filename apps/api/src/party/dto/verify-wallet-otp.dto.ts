import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeWalletUsername } from '../../common/canton-party-id';

/**
 * Body untuk `POST /party/wallet/otp/verify`.
 *
 * User input OTP 6 digit dari email → backend verify (timingSafeEqual, max 5
 * attempts) → execute onboarding atomik (Keycloak + Splice + Ledger + grant
 * rights + simpan Prisma + redeem invite).
 *
 * Frontend HARUS kirim ulang semua field (username, firstName, lastName,
 * walletInviteCode) supaya backend tidak perlu nyimpan form state di server.
 * State di-hold frontend via state machine form → otp → success.
 */
export class VerifyWalletOtpDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? (normalizeWalletUsername(value) ?? value)
      : value,
  )
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'username may contain lowercase letters, numbers, and underscores',
  })
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  @Matches(/^[0-9]+$/, { message: 'code must be 6 digits' })
  code!: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  walletInviteCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string;
}
