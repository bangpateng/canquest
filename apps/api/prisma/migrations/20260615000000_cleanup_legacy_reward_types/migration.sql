-- ============================================
-- Migration: Cleanup Legacy Reward Types
-- Date: 2026-06-15
-- Safe to run: Yes (UPDATE only, no DROP)
-- Backup required: Yes, before running
-- Run on: VPS 2 manually after backup
-- ============================================

-- Step 1: Migrate INVITE_CODE → INVITE_CODE_RANDOM
-- Affects quests that used the deprecated INVITE_CODE type
UPDATE "Quest" 
SET "rewardType" = 'INVITE_CODE_RANDOM' 
WHERE "rewardType" = 'INVITE_CODE';

-- Step 2: Migrate CC_AND_INVITE → CC_AND_CODE_RAFFLE  
-- Affects quests that used the legacy combined reward type
UPDATE "Quest" 
SET "rewardType" = 'CC_AND_CODE_RAFFLE'
WHERE "rewardType" = 'CC_AND_INVITE';

-- Step 3: Verify (run this after migration to check)
-- SELECT "rewardType", COUNT(*) 
-- FROM "Quest" 
-- GROUP BY "rewardType" 
-- ORDER BY "rewardType";
