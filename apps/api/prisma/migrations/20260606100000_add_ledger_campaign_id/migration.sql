-- Add ledgerCampaignId to Quest table
-- Stores the DAML QuestCampaign contract ID on Canton ledger
-- Used by claimFcfsSlot() to reference the on-chain campaign contract

ALTER TABLE "Quest" ADD COLUMN IF NOT EXISTS "ledgerCampaignId" TEXT;
