-- ============================================
-- Migration: L60 feed ordering — GIN index on LedgerEvent.witnessParties
-- Date: 2026-09-10
-- Safe to run: Yes (CREATE INDEX only, additive; data tak tersentuh).
--
-- Kenapa: feed personal (LedgerActivityService.getFeed) memfilter
-- `WHERE "witnessParties" @> ARRAY[party]` lalu mengurutkan kronologis via
-- `offset_`. Tanpa index GIN, filter kontainmen array = seq scan → makin
-- lambat seiring LedgerEvent tumbuh (raw layer menyimpan SEMUA update).
-- Index btree offset_ sudah ada dari migrasi L4 dan dipakai untuk ORDER BY.
--
-- CONCURRENTLY tidak dipakai: `prisma migrate deploy` membungkus tiap
-- migrasi dalam transaksi; tabel saat ini masih kecil (raw layer baru).
-- ============================================

CREATE INDEX "LedgerEvent_witnessParties_idx"
  ON "LedgerEvent" USING GIN ("witnessParties");
