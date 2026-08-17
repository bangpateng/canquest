import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Password cannot be empty' })
  password!: string;

  /** Kode 6 digit dari authenticator (wajib kalau ADMIN_TOTP_SECRET diset). */
  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Authenticator code must be 6 digits' })
  totpCode?: string;
}
