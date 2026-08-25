-- M4: upgrade wallet custodial → external (non-custodial).
-- legacyPartyId = party lama sebelum upgrade (audit; party lama kosong di chain).

ALTER TABLE "User" ADD COLUMN "legacyPartyId" TEXT;
