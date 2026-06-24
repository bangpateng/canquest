-- Migration: hapus tabel Spin (SpinItem, SpinResult) + tambah model EarnEntry.
-- Menjalankan: prisma migrate deploy (saat deploy ke staging/production).
--
-- Konteks:
--   - Fitur Spin dicabut; akuntansi poin terpotong dialihkan ke EarnEntry.
--   - SpinItem & SpinResult adalah tabel BASELINE (tidak ada di migration SQL manapun),
--     jingga DROP eksplisit di sini.
--   - EarnEntry mencatat partisipasi Earn (gate: lock 30 CC ATAU spend 200 poin, per-campaign).
--   - Enum CcTransactionType.SPIN_REWARD DIPERTAHANKAN untuk data transaksi historis.

-- 1. Buat tabel EarnEntry
CREATE TABLE "EarnEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "pointsSpent" INTEGER NOT NULL DEFAULT 0,
    "ccLockedMicro" BIGINT NOT NULL DEFAULT 0,
    "released" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarnEntry_pkey" PRIMARY KEY ("id")
);

-- Relasi balik User.earnEntries (onDelete: Cascade) + unique per (user, quest)
CREATE INDEX "EarnEntry_questId_idx" ON "EarnEntry"("questId");
CREATE UNIQUE INDEX "EarnEntry_userId_questId_key" ON "EarnEntry"("userId", "questId");
ALTER TABLE "EarnEntry"
  ADD CONSTRAINT "EarnEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Hapus tabel Spin (FK SpinResult→SpinItem + SpinResult→User sudah cascade via schema,
--    tapi DROP TABLE eksplisit aman tanpa peduli urutan constraint).
DROP TABLE IF EXISTS "SpinResult";
DROP TABLE IF EXISTS "SpinItem";
