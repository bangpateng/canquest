-- ============================================
-- Migration: Add PendingDelivery (swap delivery tertunda)
-- Date: 2026-07-12
-- Spec: Fase 1 re-architecture swap (CanQuest → async Wintip-style)
-- Safe to run: Yes (CREATE TABLE only, additive)
--
-- PendingDelivery mencatat token/CC yang swap-nya sukses di Cantex DEX
-- tapi gagal di-deliver on-chain ke user party (mis. transfer offer belum
-- di-accept, network error, balance drift). Menggantikan pola "fallback
-- off-chain credit" yang menjadi sumber drift balance user.
-- User dapat accept/reject via UI; admin dapat refund/retry.
-- ============================================

CREATE TABLE "PendingDelivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "swapTransactionId" TEXT,
    "userPartyId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "tokenAdmin" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "amountMicroCc" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "transferKind" TEXT,
    "transferInstructionCid" TEXT,
    "errorMessage" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingDelivery_pkey" PRIMARY KEY ("id")
);

-- Index: query pending delivery milik user berdasarkan status (endpoint list/accept/reject)
CREATE INDEX "PendingDelivery_userId_status_idx" ON "PendingDelivery"("userId", "status");

-- Index: query pending delivery global by status (admin / reconciler background job)
CREATE INDEX "PendingDelivery_status_createdAt_idx" ON "PendingDelivery"("status", "createdAt");

-- FK: userId → User (onDelete Cascade — hilangkan delivery bila user dihapus)
ALTER TABLE "PendingDelivery"
    ADD CONSTRAINT "PendingDelivery_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: swapTransactionId → SwapTransaction (onDelete SetNull — row tetap ada walau swap dihapus)
ALTER TABLE "PendingDelivery"
    ADD CONSTRAINT "PendingDelivery_swapTransactionId_fkey"
    FOREIGN KEY ("swapTransactionId") REFERENCES "SwapTransaction"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
