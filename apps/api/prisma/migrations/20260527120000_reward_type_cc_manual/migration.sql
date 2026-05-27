-- Add CC_MANUAL reward type (raffle CC — admin draw, winner claims after event)
ALTER TYPE "RewardType" ADD VALUE IF NOT EXISTS 'CC_MANUAL';
