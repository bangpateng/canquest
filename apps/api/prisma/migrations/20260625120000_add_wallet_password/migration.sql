-- ============================================
-- Migration: Add User wallet password (optional transaction-password gate for Send/Lock/Unlock)
-- Date: 2026-06-25
-- Safe to run: Yes (fully additive — three ADD COLUMN statements, all nullable / defaulted).
-- No existing columns are changed, renamed, or dropped. Existing rows are unaffected:
--   walletPasswordHash defaults to NULL (gate disabled until user opts in via Settings),
--   walletPasswordAttempts defaults to 0, walletPasswordLockedUntil defaults to NULL.
-- ============================================

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletPasswordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletPasswordAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletPasswordLockedUntil" TIMESTAMP(3);
