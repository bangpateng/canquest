-- ============================================
-- Migration: Add UserStatus enum + status/bannedAt/banReason (Admin Ban — Phase 1)
-- Date: 2026-06-24
-- Safe to run: Yes (fully additive — CREATE TYPE + ADD COLUMN with defaults).
-- No existing columns are changed, renamed, or dropped.
--
-- Phase 1 enforcement: login & refresh reject non-ACTIVE; ban/suspend revokes
-- all refresh tokens. Default ACTIVE keeps every existing user unaffected.
-- ============================================

-- Enum: account access state
DO $$ BEGIN
    CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- status: ACTIVE by default (all existing rows become ACTIVE — no data migration needed)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

-- bannedAt / banReason: nullable audit metadata
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bannedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banReason" TEXT;
