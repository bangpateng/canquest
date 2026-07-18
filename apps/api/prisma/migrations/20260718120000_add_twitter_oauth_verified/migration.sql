-- ============================================
-- Migration: Add Twitter OAuth verification fields
-- Date: 2026-07-18
-- Safe to run: Yes (fully additive — three ADD COLUMN statements, all nullable / defaulted).
-- No existing columns are changed, renamed, or dropped.
--
-- Backfill: twitterOAuthVerified defaults to FALSE → semua 2.1k user lama
-- (yang sudah punya twitterUsername via input teks) OTOMATIS masuk status
-- "wajib re-verify via OAuth". Tidak perlu UPDATE statement eksplisit karena
-- @default(false) di Prisma menerjemahkan ke NOT NULL DEFAULT false, yang
-- langsung berlaku untuk semua row existing & row baru.
--
-- Effect:
--   twitterOAuthVerified = FALSE  → user lama (text-input) atau user belum link X
--   twitterOAuthVerified = TRUE   → user baru yang link via OAuth (set oleh controller)
-- ============================================

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twitterOAuthVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twitterOAuthVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twitterAccountCreatedAt" TIMESTAMP(3);
