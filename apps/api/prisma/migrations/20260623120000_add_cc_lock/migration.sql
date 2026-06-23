-- ============================================
-- Migration: Add CcLock (CC Lock — non-custodial)
-- Date: 2026-06-23
-- Spec: SPEC-CC-LOCK.md (CanQuest)
-- Safe to run: Yes (CREATE TABLE only, additive)
--
-- CcLock menyimpan metadata LockedAmulet on-chain (term, expiresAt, cid, audit).
-- Jumlah terkunci (sumber kebenaran) tetap dari on-chain; tabel ini BUKAN sumber jumlah.
-- ============================================

CREATE TABLE "CcLock" (
    "id" TEXT NOT NULL,
    "ownerParty" TEXT NOT NULL,
    "userId" TEXT,
    "amountCc" DECIMAL(20,10) NOT NULL,
    "termKey" TEXT NOT NULL,
    "lockSeconds" INTEGER NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOCKED',
    "lockedAmuletCid" TEXT,
    "unlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CcLock_pkey" PRIMARY KEY ("id")
);

-- Index: pencarian lock aktif milik user (digunakan endpoint lock-status & unlock)
CREATE INDEX "CcLock_ownerParty_status_idx" ON "CcLock"("ownerParty", "status");

-- FK: userId → User (opsional, onDelete SetNull agar lock tetap utuh walau user dihapus)
ALTER TABLE "CcLock"
    ADD CONSTRAINT "CcLock_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
