import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetUserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'BANNED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'BANNED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
