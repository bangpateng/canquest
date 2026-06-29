import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { QuestKind, QuestStatus, RewardType } from '../../common/prisma-types';

/**
 * SECURITY (C2): All admin money-bearing endpoints MUST use class-validator
 * DTOs. Inline TypeScript types receive ZERO validation — the global
 * ValidationPipe (whitelist + forbidNonWhitelisted) only enforces constraints
 * on decorated classes. Without these DTOs, an admin (or a forged admin token)
 * could set rewardCc to 1e9, NaN, or a negative number and drain the reward
 * wallet, because the value flows straight into the on-chain transfer.
 *
 * The bounds below are conservative upper limits that no legitimate campaign
 * should ever exceed — they exist to stop catastrophic misconfiguration /
 * abuse, not to constrain normal use. Tune to your platform's real needs.
 */

/** Shared task sub-DTO (used by create/update quest + addTask/updateTask). */
export class AdminTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  type!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Points for off-chain earn. Bounded ≥0 and ≤ a sane cap to prevent
   *  point-pool inflation from a typo or abuse. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  points?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  target?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  correctAnswer?: string;
}

export class AdminSocialLinkDto {
  @IsIn([
    'twitter',
    'discord',
    'telegram',
    'website',
    'github',
    'youtube',
    'linkedin',
    'instagram',
    'medium',
  ])
  platform!: string;

  @IsString()
  @MaxLength(2000)
  url!: string;
}

const REWARD_TYPES = Object.values(RewardType);
const QUEST_STATUSES = Object.values(QuestStatus);
const QUEST_KINDS = Object.values(QuestKind);

/** Common money/numeric fields shared by create + update. Extracted so both
 *  DTOs stay in sync — a bound added here protects both paths. NOTE: maxWinners
 *  differs (create = number?, update = number | null?) so it is declared
 *  per-DTO, not here. */
abstract class QuestMoneyFields {
  /** CC reward per winner — drives a real on-chain transfer. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  rewardCc?: number;

  /** Fee charged to a claimant on-chain. Negative would pay the user a fee. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  claimFeeCc?: number | null;

  /** Separate quota for invite-code winners (raffle quests). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  codeWinnersQuota?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  rewardPool?: string;
}

export class CreateQuestDto extends QuestMoneyFields {
  /** Max winners / FCFS slots — create path: number only (no null). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  maxWinners?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  org!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  orgSlug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  banner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bannerImageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  deadline?: string;

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @IsOptional()
  @IsIn(QUEST_STATUSES)
  status?: QuestStatus;

  @IsOptional()
  @IsIn(REWARD_TYPES)
  rewardType?: RewardType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  winnerMessage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redeemUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  redeemInstructions?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AdminSocialLinkDto)
  socialLinks?: AdminSocialLinkDto[];

  @IsOptional()
  @IsIn(QUEST_KINDS)
  questKind?: QuestKind;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AdminTaskDto)
  tasks?: AdminTaskDto[];
}

export class UpdateQuestDto extends QuestMoneyFields {
  /** Max winners / FCFS slots — update path allows null to clear the value. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  maxWinners?: number | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  org?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  orgSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  banner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bannerImageUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  deadline?: string | null;

  @IsOptional()
  @IsString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  endsAt?: string | null;

  @IsOptional()
  @IsIn(QUEST_STATUSES)
  status?: QuestStatus;

  @IsOptional()
  @IsIn(REWARD_TYPES)
  rewardType?: RewardType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  winnerMessage?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redeemUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  redeemInstructions?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AdminSocialLinkDto)
  socialLinks?: AdminSocialLinkDto[];
}

export class AddTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  type!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  points?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  target?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  correctAnswer?: string;

  @IsOptional()
  @IsBoolean()
  showNewBadge?: boolean;

  @IsOptional()
  @IsBoolean()
  repeatEvery24h?: boolean;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  type?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  points?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  target?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  correctAnswer?: string | null;

  @IsOptional()
  @IsBoolean()
  showNewBadge?: boolean;

  @IsOptional()
  @IsBoolean()
  repeatEvery24h?: boolean;
}

/** Body for POST /quests/:questId/distribute-rewards */
export class DistributeRewardsDto {
  /** Optional subset of draw ids to distribute. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  drawIds?: string[];
}

/** Body for POST /quests/:questId/draw-winners */
export class DrawWinnersDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  count?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  userIds?: string[];
}

/** Body for POST /quests/:questId/invite-codes */
export class InviteCodesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  codes?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  generateCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  prefix?: string;
}
