import { IsEmail, IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Password cannot be empty' })
  password!: string;
}
