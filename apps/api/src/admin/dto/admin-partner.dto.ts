import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';


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

  /** Foto profil anggota — tautan gambar/API (fallback initials). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  photoUrl?: string;

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

/** Sub-DTO validator party ID { label, partyId, network, status, explorerUrl }. */
export class PartnerValidatorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(200)
  partyId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  network?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  explorerUrl?: string;
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

  /** Category value — harus cocok dengan EcosystemCategory.value (dikelola admin). */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  category!: string;

  /** Multi-kategori (tags) — EcosystemCategory.value; category = yang pertama. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  categories?: string[];

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
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PartnerValidatorDto)
  validators?: PartnerValidatorDto[];

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
