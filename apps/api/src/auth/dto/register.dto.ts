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



  /** Required when INVITE_CODES is configured on the API */

  @IsOptional()

  @IsString()

  inviteCode?: string;

}

