import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SetUsernameDto {
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may contain letters, numbers, and underscores',
  })
  username!: string;
}
