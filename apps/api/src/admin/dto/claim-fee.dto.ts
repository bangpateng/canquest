import { IsNumber, IsOptional, Min } from 'class-validator';
import { CLAIM_FEE_MIN_CC } from '../../quests/claim-fee-settings.service';

/**
 * Payload untuk PUT /admin/claim-fee.
 *
 * Field yang TIDAK dikirim dibiarkan (patch); null = kembalikan ke default
 * bawaan (Token 1, Code 0.5, Token+Code 1). Fee minimal 0.5 CC — kontrak
 * on-chain menolak campaign berfee 0 (v29 FIX-13) dan produk menetapkan
 * fee termurah 0.5 CC.
 */
export class SetClaimFeeDto {
  /** CC_ONLY / CC_MANUAL — "Token FCFS" & "Token Raffle". */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(CLAIM_FEE_MIN_CC, { message: 'Fee minimal 0.5 CC' })
  tokenFeeCc?: number | null;

  /** INVITE_CODE_FCFS / INVITE_CODE_RANDOM / dkk — "Kode waitlist". */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(CLAIM_FEE_MIN_CC, { message: 'Fee minimal 0.5 CC' })
  codeFeeCc?: number | null;

  /** CC_AND_CODE_RAFFLE — "Token + Code Raffle". */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(CLAIM_FEE_MIN_CC, { message: 'Fee minimal 0.5 CC' })
  combinedFeeCc?: number | null;
}
