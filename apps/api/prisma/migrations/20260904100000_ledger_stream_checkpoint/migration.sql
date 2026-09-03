-- Activity/history ledger-grade: offset stream WSS dipersist + guard replay.
-- Mengikuti pola resmi docs Canton (/v2/updates + Finding and Reading Data):
--   1. beginExclusive per-stream disimpan persist → restart API resume dari
--      checkpoint, event selama downtime di-replay (tidak hilang).
--   2. Apply balance oleh WSS handler dibuat idempotent lewat dedup row —
--      replay tidak double-credit CcBalance / CantexTokenBalance.

-- ── LedgerStreamCheckpoint: resume offset stream /v2/updates ────────────────
CREATE TABLE "LedgerStreamCheckpoint" (
    "streamKey" TEXT NOT NULL,
    "lastOffset" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LedgerStreamCheckpoint_pkey" PRIMARY KEY ("streamKey")
);

-- ── WssBalanceApplied: dedup apply increment (insert-before-apply) ──────────
CREATE TABLE "WssBalanceApplied" (
    "id" TEXT NOT NULL,
    "updateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WssBalanceApplied_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WssBalanceApplied_updateId_userId_scope_key" ON "WssBalanceApplied"("updateId", "userId", "scope");
CREATE INDEX "WssBalanceApplied_userId_idx" ON "WssBalanceApplied"("userId");
