import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ConnectTwitterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @Matches(/^@?[A-Za-z0-9_]{1,15}$/, {
    message: 'Username must be 1–15 characters (letters, numbers, underscore).',
  })
  username!: string;
}
