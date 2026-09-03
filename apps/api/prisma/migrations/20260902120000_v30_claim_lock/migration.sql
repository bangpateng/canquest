-- v30 (canquest-claim + canquest-lock) — ROADMAP 2b skema inti.
-- Sumber: packages/daml-v30/{AGENT,ROADMAP,SECURITY,LOCK-SPEC}.md

-- ── WinnerDraw: mirror ClaimOffer / ClaimReceipt ────────────────────────────
ALTER TABLE "WinnerDraw" ADD COLUMN "offerContractId" TEXT;
ALTER TABLE "WinnerDraw" ADD COLUMN "receiptContractId" TEXT;
ALTER TABLE "WinnerDraw" ADD COLUMN "claimStatus" TEXT;
ALTER TABLE "WinnerDraw" ADD COLUMN "validUntil" TIMESTAMP(3);
ALTER TABLE "WinnerDraw" ADD COLUMN "rewardKind" TEXT;
ALTER TABLE "WinnerDraw" ADD COLUMN "revealedCode" TEXT;
ALTER TABLE "WinnerDraw" ADD COLUMN "rewardClosedAt" TIMESTAMP(3);
ALTER TABLE "WinnerDraw" ADD COLUMN "rewardPendingNotifiedAt" TIMESTAMP(3);

-- 1 offer on-chain per winner — jaring anti double-offer (kontrak v30 tidak
-- punya contract key; DB satu-satunya penjaga, SECURITY.md §3.1).
CREATE UNIQUE INDEX "WinnerDraw_offerContractId_key" ON "WinnerDraw"("offerContractId");
CREATE INDEX "WinnerDraw_claimStatus_idx" ON "WinnerDraw"("claimStatus");

-- ── WalletInviteCode: hash storage (AGENT.md — simpan hash, bukan aslinya) ──
ALTER TABLE "WalletInviteCode" ADD COLUMN "codeHash" TEXT;
UPDATE "WalletInviteCode" SET "codeHash" = encode(sha256("code"::bytea), 'hex');
ALTER TABLE "WalletInviteCode" ALTER COLUMN "codeHash" SET NOT NULL;
CREATE UNIQUE INDEX "WalletInviteCode_codeHash_key" ON "WalletInviteCode"("codeHash");
-- Masking plaintext: nilai unik lama diganti marker (lookup selanjutnya lewat
-- codeHash; kolom code dipertahankan hanya sbg display, unique lama di-drop).
UPDATE "WalletInviteCode" SET "code" = 'hashed-' || left("codeHash", 8);
DROP INDEX "WalletInviteCode_code_key";

-- ── LockProposalRecord (canquest-lock) ──────────────────────────────────────
CREATE TABLE "LockProposalRecord" (
    "id" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contextRef" TEXT NOT NULL,
    "proposalContractId" TEXT NOT NULL,
    "receiptContractId" TEXT,
    "lockedAmuletCid" TEXT,
    "amountCc" DECIMAL(20,10) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "proposalExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "proposalWithdrawnAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "unlockedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "acceptUpdateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LockProposalRecord_pkey" PRIMARY KEY ("id")
);

-- Satu lock per (quest, user) — jalur lock CC v30.
CREATE UNIQUE INDEX "LockProposalRecord_questId_userId_key" ON "LockProposalRecord"("questId", "userId");
CREATE UNIQUE INDEX "LockProposalRecord_contextRef_key" ON "LockProposalRecord"("contextRef");
CREATE UNIQUE INDEX "LockProposalRecord_proposalContractId_key" ON "LockProposalRecord"("proposalContractId");
CREATE UNIQUE INDEX "LockProposalRecord_lockedAmuletCid_key" ON "LockProposalRecord"("lockedAmuletCid");
CREATE INDEX "LockProposalRecord_userId_status_idx" ON "LockProposalRecord"("userId", "status");
CREATE INDEX "LockProposalRecord_questId_status_idx" ON "LockProposalRecord"("questId", "status");
CREATE INDEX "LockProposalRecord_expiresAt_status_idx" ON "LockProposalRecord"("expiresAt", "status");

ALTER TABLE "LockProposalRecord"
    ADD CONSTRAINT "LockProposalRecord_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "LockProposalRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
