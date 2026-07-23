-- ============================================
-- Migration: DROP wallet password feature
-- Date: 2026-07-23
-- Reason: Wallet password (transaction gate) feature removed entirely from the
--         app (frontend + backend). Drop the three dormant columns from User so
--         the schema matches the Prisma model. bcrypt hashes + attempt counters
--         + lockout timers are no longer used anywhere.
-- ============================================

ALTER TABLE "User" DROP COLUMN IF EXISTS "walletPasswordHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "walletPasswordAttempts";
ALTER TABLE "User" DROP COLUMN IF EXISTS "walletPasswordLockedUntil";
