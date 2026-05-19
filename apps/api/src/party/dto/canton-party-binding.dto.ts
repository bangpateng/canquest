import { IsString, MaxLength, MinLength } from 'class-validator';

/** Party string from Participant / Canton — persisted after validation in later phases. */
export class CantonPartyBindingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  cantonPartyId!: string;
}
