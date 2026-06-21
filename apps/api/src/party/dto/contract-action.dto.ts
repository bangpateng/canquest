import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Shared request body for ledger action endpoints that target a single
 * contract by id, with an optional discriminator between the legacy
 * TransferOffer flow and the CIP-0056 TransferInstruction flow.
 *
 * Endpoints using this:
 *   POST /api/party/accept-offer          { contractId }
 *   POST /api/party/reject-offer          { contractId }
 *   POST /api/party/offers/accept         { contractId, type? }
 *   POST /api/party/offers/reject         { contractId, type? }
 *   POST /api/party/transfer-instruction/accept   { transferInstructionCid }
 *   POST /api/party/transfer-instruction/reject   { transferInstructionCid }
 *   POST /api/party/transfer-instruction/withdraw { transferInstructionCid }
 *
 * Why a real class (not an inline TS interface): the global ValidationPipe runs
 * `forbidNonWhitelisted: true`, but it only enforces that against DTO classes.
 * Inline `@Body() body: { contractId: string }` is erased at runtime, so a
 * malformed/oversized payload reached the ledger call unchecked. The bounds
 * below (length + enum) reject absurd or probe payloads before they touch the
 * Canton Ledger API, without affecting any field the frontend actually sends.
 */
export enum OfferType {
  TRANSFER_OFFER = 'transfer_offer',
  TRANSFER_INSTRUCTION = 'transfer_instruction',
}

export class ContractActionDto {
  @IsString()
  @MinLength(1, { message: 'contractId is required.' })
  @MaxLength(512)
  contractId!: string;

  /** Discriminator for endpoints that handle both offer kinds. Ignored by
   *  endpoints that only ever deal with one kind. */
  @IsOptional()
  @IsEnum(OfferType)
  type?: OfferType;
}

/**
 * Body for the CIP-0056 transfer-instruction endpoints. The field is named
 * transferInstructionCid to match what the frontend already sends; we alias
 * it to the same bounds as ContractActionDto.contractId.
 */
export class TransferInstructionActionDto {
  @IsString()
  @MinLength(1, { message: 'transferInstructionCid is required.' })
  @MaxLength(512)
  transferInstructionCid!: string;
}
