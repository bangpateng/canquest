import { IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Payload untuk PUT /admin/claim-fee.
 *
 * Field yang TIDAK dikirim dibiarkan (patch); null = kembalikan ke default
 * bawaan (Token 3, Code 2, Token+Code 3). Fee > 0 wajib — kontrak on-chain
 * menolak campaign berfee 0 (v29 FIX-13).
 */
export class SetClaimFeeDto {
  /** CC_ONLY / CC_MANUAL — "Token FCFS" & "Token Raffle". */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  tokenFeeCc?: number | null;

  /** INVITE_CODE_FCFS / INVITE_CODE_RANDOM / dkk — "Kode waitlist". */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  codeFeeCc?: number | null;

  /** CC_AND_CODE_RAFFLE — "Token + Code Raffle". */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01)
  combinedFeeCc?: number | null;
}
