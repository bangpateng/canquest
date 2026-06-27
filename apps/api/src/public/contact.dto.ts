import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/**
 * Body for POST /api/public/contact — the Cooperation / partnership form.
 * Validates server-side via the global ValidationPipe (whitelist + forbidNonWhitelisted).
 */
export enum CollaborationType {
  EARN_CAMPAIGN = 'earn_campaign',
  EVENT_LAUNCH = 'event_launch',
  ECOSYSTEM = 'ecosystem',
  OTHER = 'other',
}

export class ContactDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  organization?: string;

  @IsOptional()
  @IsEnum(CollaborationType)
  collaborationType?: CollaborationType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  budget?: string;

  @IsString()
  @Length(10, 4000)
  message!: string;
}
