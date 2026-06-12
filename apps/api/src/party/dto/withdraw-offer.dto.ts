import { IsString, MinLength } from 'class-validator';

/** Request body for POST /api/party/withdraw-offer */
export class WithdrawOfferDto {
  @IsString()
  @MinLength(1)
  contractId!: string;
}