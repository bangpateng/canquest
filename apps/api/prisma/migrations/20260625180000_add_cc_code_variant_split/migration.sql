-- ============================================
-- Migration: CC+Code Raffle variant split (some winners get Code, some get CC)
-- Date: 2026-06-25
-- Safe to run: Yes (fully additive — two ADD COLUMN IF NOT EXISTS, both nullable).
-- No existing columns are changed, renamed, or dropped. Existing rows are
-- unaffected: Quest.codeWinnersQuota defaults to NULL (legacy "both" behavior),
-- WinnerDraw.rewardVariant defaults to NULL (legacy "both" path at claim time).
-- ============================================

ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "codeWinnersQuota" INTEGER;

ALTER TABLE "WinnerDraw" ADD COLUMN IF NOT EXISTS "rewardVariant" TEXT;
