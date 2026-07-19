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
 * Body untuk `POST /party/wallet/otp/send`.
 *
 * Frontend submit form create wallet → backend validasi username + invite code
 * (pre-flight, NO onboard) → issue OTP 6 digit → simpan ke User.otpCodeHash +
 * otpExpiresAt → kirim via ResendEmailService.sendWalletCreationOtp.
 *
 * Field sama seperti SetUsernameDto (firstName/lastName ikut supaya user tidak
 * perlu re-input saat verify).
 */
export class SendWalletOtpDto {
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
