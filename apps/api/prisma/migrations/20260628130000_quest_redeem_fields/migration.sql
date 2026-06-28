-- Add per-quest redeem config for the "How to use your code" reveal.
-- redeemUrl: link register/landing proyek (shown as "Open" button in the reveal).
-- redeemInstructions: custom multi-line instructions; null = use default 3-step template.
ALTER TABLE "Quest" ADD COLUMN "redeemUrl" TEXT;
ALTER TABLE "Quest" ADD COLUMN "redeemInstructions" TEXT;
