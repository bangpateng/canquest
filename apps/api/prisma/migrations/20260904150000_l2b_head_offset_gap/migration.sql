-- ============================================
-- Migration: L2b — headOffset (lag) + LedgerStreamGap (rentang hilang persist)
-- Date: 2026-09-04
-- Safe to run: Yes (ADD COLUMN nullable + CREATE TABLE only, additive)
--
-- Latar: aturan resume 48 jam diganti cek latest-pruned-offsets. Dua hal baru:
--   1. headOffset pada LedgerStreamCheckpoint — HEAD ledger dari heartbeat
--      OffsetCheckpoint; khusus pengukuran lag (head − last), bukan resume.
--      Dibaca endpoint /api/health/ingestion (monitoring L7 tinggal pakai).
--   2. LedgerStreamGap — saat checkpoint ≤ prunedUpToInclusive, rentang yang
--      tidak bisa di-replay dicatat ke DB dengan timestamp (log pm2 terputar
--      habis; pertanyaan "kenapa riwayat bolong" berbulan kemudian butuh baris).
-- ============================================

-- Head ledger untuk lag (nullable — terisi setelah heartbeat pertama).
ALTER TABLE "LedgerStreamCheckpoint"
    ADD COLUMN "headOffset" BIGINT,
    ADD COLUMN "headUpdatedAt" TIMESTAMP(3);

-- Rentang offset yang diketahui hilang permanen (pruning).
CREATE TABLE "LedgerStreamGap" (
    "id"         TEXT   NOT NULL,
    "streamKey"  TEXT   NOT NULL,
    "fromOffset" BIGINT NOT NULL,
    "toOffset"   BIGINT NOT NULL,
    "reason"     TEXT   NOT NULL DEFAULT 'checkpoint-behind-pruning',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerStreamGap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerStreamGap_streamKey_detectedAt_idx"
    ON "LedgerStreamGap"("streamKey", "detectedAt");
