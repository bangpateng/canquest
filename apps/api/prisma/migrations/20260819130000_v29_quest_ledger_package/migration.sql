-- v29 version-pinning (cutover v28→v29 di mainnet):
-- Quest.ledgerPackage mencatat nama paket DAML kontrak on-chain campaign
-- ('canquest-v29' ke atas). Quest lama (null + ledgerCampaignId terisi)
-- dianggap 'canquest-v28' oleh backend — claim path memilih template ID,
-- payload choice, dan semantik eligibility sesuai versi paket masing-masing.
ALTER TABLE "Quest" ADD COLUMN "ledgerPackage" TEXT;
