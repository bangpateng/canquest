-- ============================================
-- Migration: Add CC_LOCK & CC_UNLOCK to CcTransactionType enum
-- Date: 2026-06-23
-- Spec: SPEC-TX-HISTORY-NOTIF.md BAGIAN A1 (CanQuest)
-- Safe to run: Yes (ALTER TYPE ADD VALUE, additive; idempotent via IF NOT EXISTS guard)
--
-- Dua tipe baru untuk pencatatan history lock/unlock (non-custodial).
-- Tidak mengubah perilaku lock/unlock itu sendiri — hanya menambah row display.
-- ============================================

ALTER TYPE "CcTransactionType" ADD VALUE IF NOT EXISTS 'CC_LOCK';
ALTER TYPE "CcTransactionType" ADD VALUE IF NOT EXISTS 'CC_UNLOCK';
