-- ============================================
-- Migration: Singleton constraint for the EARN_HUB quest
-- Date: 2026-07-22
-- Safe to run: Yes (additive partial unique index; existing rows untouched)
--
-- Konteks:
-- Sebelumnya hanya ada pengecekan app-layer (findFirst race di admin.service.ts)
-- untuk mencegah duplikat quest EARN_HUB. Ini TOCTOU race — bisa kalah di bawah
-- concurrency. Constraint DB memaksa max 1 baris EARN_HUB secara hard.
--
-- Partial unique index: hanya membatasi baris dengan questKind = 'EARN_HUB',
-- sehingga CAMPAIGN boleh banyak. Pola ini konsisten dengan preferensi tim
-- untuk enforcement DB-level (lihat komentar cantonPartyId @unique di schema).
--
-- PRE-FLIGHT: jalankan cek duplikat sebelum apply. Kalau ada >1 row EARN_HUB,
-- konsolidasi manual dulu (pindah tasks ke 1, hapus/hapus yang lain):
--   SELECT id FROM "Quest" WHERE "questKind" = 'EARN_HUB';
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS "quest_earn_hub_singleton"
    ON "Quest" ("questKind")
    WHERE "questKind" = 'EARN_HUB';
