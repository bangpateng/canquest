import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}
