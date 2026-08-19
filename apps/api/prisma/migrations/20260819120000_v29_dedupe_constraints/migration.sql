-- v29: Dedupe DB (pengganti contract keys — SDK 3.x tidak mendukung contract keys).
--
-- Uniqueness campaignId / claimId / lockId + kolom lockId/coinLockCid untuk
-- cross-check FIX-11 di claim path LOCK_CC. Lihat HANDOFF_DAML_V31.md Langkah 2.3.
--
-- Catatan: semua kolom baru nullable — Postgres unique index mengizinkan
-- banyak NULL, jadi data existing (belum punya nilai) tidak melanggar.

-- Quest.ledgerCampaignId unique: 1 quest ↔ 1 QuestCampaign on-chain.
CREATE UNIQUE INDEX "Quest_ledgerCampaignId_key" ON "Quest"("ledgerCampaignId");

-- WinnerDraw.claimId unique: claimId on-chain (ClaimSlot/DrawWinner) tidak
-- boleh dipakai 2 baris reward. FCFS/raffle = WinnerDraw.id (unik via PK);
-- jalur invite = "code-<drawId|questId:userId>" (deterministik).
ALTER TABLE "WinnerDraw" ADD COLUMN "claimId" TEXT;
CREATE UNIQUE INDEX "WinnerDraw_claimId_key" ON "WinnerDraw"("claimId");

-- CcLock.lockedAmuletCid unique: reconciler backfill idempoten (1 LockedAmulet
-- on-chain ↔ maksimal 1 baris cc_locks).
CREATE UNIQUE INDEX "CcLock_lockedAmuletCid_key" ON "CcLock"("lockedAmuletCid");

-- CampaignEligibilityLedger: lockId (FIX-11 cross-check dgn CoinLock.lockId)
-- + coinLockCid (contract id Main:CoinLock utk choice arg ClaimSlot/DrawWinner).
ALTER TABLE "CampaignEligibilityLedger" ADD COLUMN "lockId" TEXT;
ALTER TABLE "CampaignEligibilityLedger" ADD COLUMN "coinLockCid" TEXT;
CREATE INDEX "CampaignEligibilityLedger_lockId_idx" ON "CampaignEligibilityLedger"("lockId");
