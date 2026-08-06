-- v25: DAML eligibility (CampaignEligibility) + PlatformTransfer (atomic send+fee).
--
-- Quest: +field eligibilityType + eligibilityAmount (backend map dari entryGateMode).
--   eligibilityType = "NONE" (default) → backward-compat, semua quest existing tidak berubah.
--   "LOCK_CC" / "POINTS" → backend isi eligibilityAmount saat createQuestCampaign.
--
-- 2 tabel baru:
--   CampaignEligibilityLedger — cache DAML CampaignEligibility contract (LOCK_CC / POINTS proof)
--   PlatformTransferLedger    — cache DAML PlatformTransfer contract (atomic send+fee)

-- Quest: eligibility config (mirror DAML QuestCampaign field).
ALTER TABLE "Quest" ADD COLUMN "eligibilityType" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Quest" ADD COLUMN "eligibilityAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
COMMENT ON COLUMN "Quest"."eligibilityType" IS 'v25 DAML eligibility: "NONE"|"LOCK_CC"|"POINTS". Backend map dari entryGateMode.';
COMMENT ON COLUMN "Quest"."eligibilityAmount" IS 'v25 DAML min amount (CC locked utk LOCK_CC, points utk POINTS). 0 bila NONE.';

-- CampaignEligibilityLedger: mirror DAML CampaignEligibility contract.
CREATE TABLE "CampaignEligibilityLedger" (
    "id"              TEXT NOT NULL,
    "questId"         TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "contractId"      TEXT NOT NULL,
    "eligibilityType" TEXT NOT NULL,
    "amount"          DOUBLE PRECISION NOT NULL,
    "lockedAt"        TIMESTAMP(3),
    "status"          TEXT NOT NULL DEFAULT 'ELIGIBLE',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignEligibilityLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CampaignEligibilityLedger_contractId_key" ON "CampaignEligibilityLedger"("contractId");
CREATE UNIQUE INDEX "CampaignEligibilityLedger_questId_userId_key" ON "CampaignEligibilityLedger"("questId", "userId");
CREATE INDEX "CampaignEligibilityLedger_userId_status_idx" ON "CampaignEligibilityLedger"("userId", "status");
CREATE INDEX "CampaignEligibilityLedger_questId_status_idx" ON "CampaignEligibilityLedger"("questId", "status");

-- PlatformTransferLedger: mirror DAML PlatformTransfer contract.
CREATE TABLE "PlatformTransferLedger" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "amount"     DOUBLE PRECISION NOT NULL,
    "feeAmount"  DOUBLE PRECISION NOT NULL,
    "receiver"   TEXT NOT NULL,
    "treasury"   TEXT NOT NULL,
    "token"      TEXT NOT NULL DEFAULT 'CC',
    "contractId" TEXT,
    "status"     TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformTransferLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlatformTransferLedger_transferId_key" ON "PlatformTransferLedger"("transferId");
CREATE INDEX "PlatformTransferLedger_userId_status_idx" ON "PlatformTransferLedger"("userId", "status");
CREATE INDEX "PlatformTransferLedger_status_createdAt_idx" ON "PlatformTransferLedger"("status", "createdAt");
