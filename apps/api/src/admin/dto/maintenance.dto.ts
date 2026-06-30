import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Payload untuk PUT /admin/maintenance.
 * `enabled` wajib; title/message/estimatedEnd opsional (akan fallback ke default).
 */
export class SetMaintenanceDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  /** ISO 8601 datetime string, atau null untuk menghapus estimasi. */
  @IsOptional()
  @IsISO8601({ strict: true })
  estimatedEnd?: string | null;
}
