-- ============================================
-- Migration: Add TokenTransaction (P2P token transfer history, CIP-0056 two-step)
-- Date: 2026-07-12
-- Spec: P2P token transfer on-chain (USDCx etc.) — rencana approved
-- Safe to run: Yes (CREATE TABLE + CREATE TYPE only, additive)
--
-- TokenTransaction = riwayat P2P transfer token non-CC on-chain.
-- CcTransaction strictly CC (amountMicroCc, no instrument field) — menumpang
-- amount token non-CC di situ akan corrupt audit trail & reconcile CC.
-- Model ini instrument-aware: amount pakai Decimal(38,18) sesuai Cantex API.
--
-- Sumber kebenaran saldo token = ON-CHAIN (queryTokenHoldings).
-- CantexTokenBalance (DB) jadi cache/UI-only — BUKAN dipakai validate send-token.
-- ============================================

-- Tipe event P2P token transfer
CREATE TYPE "TokenTxType" AS ENUM (
    'TOKEN_TRANSFER_OUT',
    'TOKEN_TRANSFER_IN',
    'TOKEN_OFFER_PENDING',
    'TOKEN_OFFER_REJECTED',
    'TOKEN_OFFER_WITHDRAWN',
    'TOKEN_FEE_OUT'
);

CREATE TABLE "TokenTransaction" (
    "id"                     TEXT           NOT NULL,
    "userId"                 TEXT           NOT NULL,
    "instrumentId"           TEXT           NOT NULL,
    "instrumentAdmin"        TEXT           NOT NULL,
    "amount"                 DECIMAL(38,18) NOT NULL,
    "type"                   "TokenTxType"  NOT NULL,
    "description"            TEXT,
    "referenceId"            TEXT,
    "ledgerTxId"             TEXT,
    "cantonUpdateId"         TEXT,
    "transferInstructionCid" TEXT,
    "status"                 TEXT           NOT NULL DEFAULT 'COMPLETED',
    "createdAt"              TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenTransaction_pkey" PRIMARY KEY ("id")
);

-- Idempotency: satu row per (userId, ledgerTxId) — cegah duplikat history bila
-- command di-replay (commandId deterministik dari clientNonce).
CREATE UNIQUE INDEX "TokenTransaction_userId_ledgerTxId_key"
    ON "TokenTransaction"("userId", "ledgerTxId");

-- Index: lookup by Canton update id (explorer link / reconcile).
CREATE INDEX "TokenTransaction_cantonUpdateId_idx" ON "TokenTransaction"("cantonUpdateId");

-- Index: lookup by TransferInstruction contract id (accept/reject lookup).
CREATE INDEX "TokenTransaction_transferInstructionCid_idx" ON "TokenTransaction"("transferInstructionCid");

-- Index: riwayat transfer per (user, token) — tampil di wallet history.
CREATE INDEX "TokenTransaction_userId_instrumentId_instrumentAdmin_idx"
    ON "TokenTransaction"("userId", "instrumentId", "instrumentAdmin");

-- FK: userId → User (onDelete Cascade — hilangkan history bila user dihapus)
ALTER TABLE "TokenTransaction"
    ADD CONSTRAINT "TokenTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
