-- ============================================
-- Migration: L4 — pipeline paralel ledger-derived activity (raw layer + proyeksi)
-- Date: 2026-09-04
-- Safe to run: Yes (CREATE TABLE only, additive; tabel lama tak tersentuh).
--
-- Desain mengikuti spec Part B §4 + koreksi Phase 4 #1: raw layer TIDAK
-- di-key per party. Stream wildcard menyimpan update APA ADANYA, sekali;
-- witnessParties disimpan sebagai array; atribusi party→user terjadi di
-- proyeksi (L6) via User.cantonPartyId — bisa di-derive ulang kapan pun
-- tanpa menyentuh ledger, dan user yang mendapat wallet kemudian tetap
-- punya riwayat penuh tanpa backfill ulang.
--
-- Empat tabel:
--   LedgerUpdate — envelope mentah per updateId (kebenaran tak terubahkan;
--                  LedgerEvent bisa direbuild dari sini).
--   LedgerEvent  — event ternormalisasi, PK (updateId, eventIndex).
--   Instrument   — identitas (admin, id) + allowlist (diisi pasca-L5 dari raw).
--   Activity     — proyeksi per-party; satu-satunya penulis = klasifier L6.
--
-- Cursor pipeline baru memakai LedgerStreamCheckpoint yang sudah ada
-- (streamKey terpisah, mis. 'ledger-backfill' / 'ledger-live').
-- ============================================

CREATE TABLE "LedgerUpdate" (
    "updateId"       TEXT   NOT NULL,
    "offset_"        BIGINT NOT NULL,
    "recordTime"     TIMESTAMP(3) NOT NULL,
    "commandId"      TEXT,
    "synchronizerId" TEXT,
    "envelope"       JSONB  NOT NULL,
    "ingestedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerUpdate_pkey" PRIMARY KEY ("updateId")
);
CREATE INDEX "LedgerUpdate_offset__idx" ON "LedgerUpdate"("offset_");
CREATE INDEX "LedgerUpdate_recordTime_idx" ON "LedgerUpdate"("recordTime");

CREATE TABLE "LedgerEvent" (
    "updateId"       TEXT   NOT NULL,
    "eventIndex"     INTEGER NOT NULL,
    "offset_"        BIGINT NOT NULL,
    "recordTime"     TIMESTAMP(3) NOT NULL,
    "eventType"      TEXT   NOT NULL,
    "templateId"     TEXT,
    "choice"         TEXT,
    "contractId"     TEXT,
    "witnessParties" TEXT[] NOT NULL DEFAULT '{}',
    "payload"        JSONB  NOT NULL,
    "ingestedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEvent_pkey" PRIMARY KEY ("updateId", "eventIndex")
);
CREATE INDEX "LedgerEvent_contractId_idx" ON "LedgerEvent"("contractId");
CREATE INDEX "LedgerEvent_offset__idx" ON "LedgerEvent"("offset_");
CREATE INDEX "LedgerEvent_templateId_idx" ON "LedgerEvent"("templateId");

CREATE TABLE "Instrument" (
    "admin"         TEXT   NOT NULL,
    "id"            TEXT   NOT NULL,
    "symbol"        TEXT,
    "displayName"   TEXT,
    "decimals"      INTEGER,
    "isAllowlisted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("admin", "id")
);

CREATE TABLE "Activity" (
    "partyId"         TEXT   NOT NULL,
    "activityId"      TEXT   NOT NULL,
    "kind"            TEXT   NOT NULL,
    "direction"       TEXT,
    "instrumentAdmin" TEXT   NOT NULL,
    "instrumentId"    TEXT   NOT NULL,
    "amount"          DECIMAL(38,10) NOT NULL,
    "fee"             DECIMAL(38,10),
    "counterparty"    TEXT,
    "memo"            TEXT,
    "status"          TEXT   NOT NULL,
    "executeBefore"   TIMESTAMP(3),
    "correlationId"   TEXT,
    "createdUpdateId" TEXT   NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL,
    "settledUpdateId" TEXT,
    "settledAt"       TIMESTAMP(3),
    "lastOffset"      BIGINT NOT NULL,
    CONSTRAINT "Activity_pkey" PRIMARY KEY ("partyId", "activityId")
);
CREATE INDEX "Activity_partyId_createdAt_activityId_idx"
    ON "Activity"("partyId", "createdAt" DESC, "activityId" DESC);
CREATE INDEX "Activity_instrumentAdmin_instrumentId_idx"
    ON "Activity"("instrumentAdmin", "instrumentId");
CREATE INDEX "Activity_status_executeBefore_idx"
    ON "Activity"("status", "executeBefore");
