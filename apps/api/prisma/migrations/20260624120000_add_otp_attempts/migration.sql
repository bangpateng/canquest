-- ============================================
-- Migration: Add User.otpAttempts (OTP hardening — failed-attempt lockout)
-- Date: 2026-06-24
-- Safe to run: Yes (fully additive — single ADD COLUMN with a default).
-- No existing columns are changed, renamed, or dropped. Existing rows are
-- backfilled to 0 by the DEFAULT, so verified users are entirely unaffected.
-- ============================================

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "otpAttempts" INTEGER NOT NULL DEFAULT 0;
