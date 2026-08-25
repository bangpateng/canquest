import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * M3b: klaim oleh user external (non-custodial) — fee sudah dibayar via
 * tanda tangan browser (flow quest_claim_fcfs_fee); updateId fee disertakan
 * supaya claim melewati collectClaimFee custodial.
 */
export class ClaimExternalFeeDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  externalFeeTxId?: string;
}
