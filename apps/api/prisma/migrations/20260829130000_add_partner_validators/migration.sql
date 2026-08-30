-- Ecosystem partner: validator party-ID cards (Validator tab on partner detail).
ALTER TABLE "Partner" ADD COLUMN "validators" TEXT NOT NULL DEFAULT '[]';
