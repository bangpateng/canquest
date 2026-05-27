import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { normalizeWalletUsername } from '../../common/canton-party-id';

export class SetUsernameDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? (normalizeWalletUsername(value) ?? value) : value,
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
}
