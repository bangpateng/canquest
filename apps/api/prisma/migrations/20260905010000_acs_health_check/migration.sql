-- ============================================
-- Migration: monitor insiden ACS party-scoped gelap (2026-09-05)
-- Safe to run: Yes (CREATE TABLE only, additive).
-- Bukti ke DB, bukan hanya log — lihat model AcsHealthCheck di schema.prisma.
-- ============================================

CREATE TABLE "AcsHealthCheck" (
    "id"         TEXT   NOT NULL,
    "checkedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "party"      TEXT   NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "rows"       INTEGER NOT NULL,
    "ledgerEnd"  BIGINT NOT NULL,
    "note"       TEXT,
    CONSTRAINT "AcsHealthCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AcsHealthCheck_checkedAt_idx" ON "AcsHealthCheck"("checkedAt");
CREATE INDEX "AcsHealthCheck_party_checkedAt_idx" ON "AcsHealthCheck"("party", "checkedAt");
