-- Migration: Add CC_AND_CODE_RAFFLE reward type
-- Combined raffle: winners get both CC reward AND an invite code in one event; each claim costs 5 CC

ALTER TYPE "RewardType" ADD VALUE IF NOT EXISTS 'CC_AND_CODE_RAFFLE';
