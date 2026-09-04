-- ============================================
-- Migration: L5.0 — tabel AcsOpeningBalance (baseline rekonsiliasi L9)
-- Date: 2026-09-04
-- Safe to run: Yes (CREATE TABLE only, additive).
--
-- Snapshot ACS pada offset titik-nol node (819747, 2026-06-08). Diambil
-- sekali selagi pruned=0 — activeAtOffset historis tak bisa dilayani lagi
-- begitu node pernah memangkas. Baseline pembuka utk rekonsiliasi L9:
--   pembuka + Σnet(activity) == ACS kini.
-- ============================================

CREATE TABLE "AcsOpeningBalance" (
    "partyId"         TEXT   NOT NULL,
    "atOffset"        BIGINT NOT NULL,
    "takenAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSeenOffset" BIGINT,
    "holdings"        JSONB  NOT NULL,
    "sums"            JSONB  NOT NULL,
    CONSTRAINT "AcsOpeningBalance_pkey" PRIMARY KEY ("partyId")
);
