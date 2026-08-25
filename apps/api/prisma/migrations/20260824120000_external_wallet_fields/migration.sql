-- M2: wallet non-custodial (external party).
-- walletKind: null = belum ada wallet, "custodial" = party lama (namespace
-- validator, kunci server), "external" = non-custodial (kunci di browser user).
-- backupVerifiedAt: timestamp verifikasi backup kunci (key ceremony).

ALTER TABLE "User" ADD COLUMN "walletKind" TEXT;
ALTER TABLE "User" ADD COLUMN "backupVerifiedAt" TIMESTAMP(3);

-- Backfill: semua user yang sudah punya party hari ini pasti custodial.
UPDATE "User" SET "walletKind" = 'custodial' WHERE "cantonPartyId" IS NOT NULL;
