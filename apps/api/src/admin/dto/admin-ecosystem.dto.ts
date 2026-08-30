import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartnerSocialLinkDto } from './admin-partner.dto';

/** Body create/update kategori ecosystem. */
export class AdminEcosystemCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  value!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** Body update parsial kategori (label/sortOrder saja). */
export class AdminEcosystemCategoryPatchDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** Body pengaturan global ecosystem (social links). */
export class AdminEcosystemSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PartnerSocialLinkDto)
  socialLinks?: PartnerSocialLinkDto[];
}
