import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  /** X (Twitter) handle — used for profile + quest verification. */
  @IsString()
  @MinLength(1)
  @MaxLength(15)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'X username may only contain letters, numbers, and underscore' })
  twitterUsername!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}
