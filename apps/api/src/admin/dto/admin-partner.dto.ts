import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PARTNER_CATEGORIES, PartnerCategory } from '../../common/prisma-types';

/** Sub-DTO social link { platform, url } — dipakai partner & team member. */
export class PartnerSocialLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  platform!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  url!: string;
}

/** Sub-DTO team member { initials, name, role, socials[] }. */
export class PartnerTeamMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4)
  initials!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  role!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PartnerSocialLinkDto)
  socials?: PartnerSocialLinkDto[];
}

/** Sub-DTO app featured { name, description, url }. */
export class PartnerAppFeaturedDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}

/** Sub-DTO feature highlight { title, description } — Features tab. */
export class PartnerFeatureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** Body create/update partner (admin). Semua field divalidasi ketat. */
export class AdminPartnerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4)
  initials!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;

  @IsIn(PARTNER_CATEGORIES)
  category!: PartnerCategory;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PartnerSocialLinkDto)
  socialLinks?: PartnerSocialLinkDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PartnerTeamMemberDto)
  team?: PartnerTeamMemberDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PartnerAppFeaturedDto)
  appsFeatured?: PartnerAppFeaturedDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PartnerFeatureDto)
  features?: PartnerFeatureDto[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
