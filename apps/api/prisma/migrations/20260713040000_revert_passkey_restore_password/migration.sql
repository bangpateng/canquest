-- ============================================
-- Migration: REVERT passkey → restore wallet password
-- Date: 2026-07-13
-- Reason: DB connection pool issues (P2024) made passkey unreliable; revert
--         to wallet password (same forced-enrollment architecture).
-- ============================================

-- 1. Drop passkey tables (created by 20260713000000_add_passkey_credentials).
DROP TABLE IF EXISTS "PasskeyCredential";
DROP TABLE IF EXISTS "BackupCode";

-- 2. Drop passkeyEnrolledAt column from User.
ALTER TABLE "User" DROP COLUMN IF EXISTS "passkeyEnrolledAt";

-- 3. Restore wallet password columns on User (idempotent — IF NOT EXISTS).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletPasswordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletPasswordAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "walletPasswordLockedUntil" TIMESTAMP(3);
