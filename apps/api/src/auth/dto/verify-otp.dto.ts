import { IsString, Length, MinLength } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @MinLength(20)
  userId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
