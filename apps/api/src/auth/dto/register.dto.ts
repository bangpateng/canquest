import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';



export class RegisterDto {

  @IsString()

  @MinLength(2)

  @MaxLength(80)

  displayName!: string;



  @IsEmail()

  email!: string;



  @IsString()

  @MinLength(8)

  password!: string;



  /** Friend's referral code (optional) — referrer earns points after you verify email */

  @IsOptional()

  @IsString()

  @MaxLength(32)

  referralCode?: string;

}

