-- ============================================
-- Migration: L60 — canonical raw ledger nullable time/offset + effectiveAt
-- Safe to run: Yes (ALTER COLUMN only, additive/relaxing; no data touched).
--
-- Konteks (audit #4/#5): Transaction.value di LEDGER_EFFECTS TIDAK membawa
-- recordTime / synchronizerId / top-level offset (keduanya hanya ada di
-- heartbeat OffsetCheckpoint; offset hanya per-event di ExercisedEvent).
-- Kolom NOT NULL lama memaksa backfill DROP setiap update (Number(undefined
-- offset) = NaN) atau Invalid Date. Migrasi ini membuat kolom nullable dan
-- menambah effectiveAt (jam ledger per transaksi, Transaction.value.
-- effectiveAt) sebagai kolom queryable — recordTime TIDAK PERNAH diisi dari
-- effectiveAt/heartbeat (nilai semantik berbeda).
-- ============================================

-- LedgerUpdate: offset_ + recordTime nullable, tambah effectiveAt.
ALTER TABLE "LedgerUpdate" ALTER COLUMN "offset_" DROP NOT NULL;
ALTER TABLE "LedgerUpdate" ALTER COLUMN "recordTime" DROP NOT NULL;
ALTER TABLE "LedgerUpdate" ADD COLUMN "effectiveAt" TIMESTAMP(3);

-- LedgerEvent: offset_ + recordTime nullable.
ALTER TABLE "LedgerEvent" ALTER COLUMN "offset_" DROP NOT NULL;
ALTER TABLE "LedgerEvent" ALTER COLUMN "recordTime" DROP NOT NULL;

CREATE INDEX "LedgerUpdate_effectiveAt_idx" ON "LedgerUpdate"("effectiveAt");
