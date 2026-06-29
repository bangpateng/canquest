-- SECURITY (H6): Enforce 1 Canton wallet ↔ 1 user account at the DB level.
--
-- Before this migration, `User.cantonPartyId` had no uniqueness constraint.
-- A single funded wallet could be bound to many accounts, letting one attacker
-- claim quest rewards / FCFS slots / raffle entries N times via N email
-- accounts sharing one wallet (anti-sybil bypass). This migration adds a
-- UNIQUE constraint on cantonPartyId.
--
-- SAFETY: If duplicate (cantonPartyId) rows already exist, the unique index
-- creation would FAIL. Step 1 nulls out the cantonPartyId on all-but-the-latest
-- row per duplicate group BEFORE adding the constraint, so this migration is
-- idempotent and safe to run on a live table (including an empty one).
-- Nulling (not deleting) preserves the user accounts; they just lose the wallet
-- binding and must rebind. The kept row is the most recently updated one per
-- partyId, which is the binding the user most recently acted on.

-- Step 1: De-duplicate. For each cantonPartyId owned by >1 user, keep only the
-- most-recently-updated user's binding; null the rest. Skips placeholder IDs
-- (canquest:*) which are pre-wallet placeholders, and NULLs (already unbound).
UPDATE "User" u
SET "cantonPartyId" = NULL
WHERE u."cantonPartyId" IS NOT NULL
  AND u."cantonPartyId" NOT LIKE 'canquest:%'
  AND u."updatedAt" <> (
    SELECT MAX(keep."updatedAt")
    FROM "User" keep
    WHERE keep."cantonPartyId" = u."cantonPartyId"
  )
  AND EXISTS (
    SELECT 1
    FROM "User" other
    WHERE other."cantonPartyId" = u."cantonPartyId"
      AND other."id" <> u."id"
  );

-- Step 2: Add the unique constraint. Now safe because step 1 removed all dups.
-- CONCURRENTLY would be ideal but cannot run inside a migration transaction;
-- CREATE UNIQUE INDEX (without CONCURRENTLY) is what Prisma migrate expects.
CREATE UNIQUE INDEX IF NOT EXISTS "User_cantonPartyId_key"
  ON "User"("cantonPartyId");
