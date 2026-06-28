-- ============================================
-- Migration: Add toggle action types to CcTransactionType enum
-- Date: 2026-06-28
-- Spec: Transaction history integrity — onchain toggle actions must be recorded
-- Safe to run: Yes (ALTER TYPE ADD VALUE, additive; idempotent via IF NOT EXISTS guard)
--
-- Empat tipe baru untuk pencatatan history aksi onchain yang sebelumnya
-- tidak meninggalkan jejak di tabel CcTransaction (Reject/Withdraw offer,
-- Enable/Disable preapproval). Mutasi onchain ini punya tx id dan kini
-- dicatat agar "terkirim tapi history gagal" tidak terjadi.
-- ============================================

ALTER TYPE "CcTransactionType" ADD VALUE IF NOT EXISTS 'OFFER_REJECTED';
ALTER TYPE "CcTransactionType" ADD VALUE IF NOT EXISTS 'OFFER_WITHDRAWN';
ALTER TYPE "CcTransactionType" ADD VALUE IF NOT EXISTS 'PREAPPROVAL_ENABLED';
ALTER TYPE "CcTransactionType" ADD VALUE IF NOT EXISTS 'PREAPPROVAL_DISABLED';
