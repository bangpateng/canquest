import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AllocateWalletDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  walletInviteCode?: string;
}
