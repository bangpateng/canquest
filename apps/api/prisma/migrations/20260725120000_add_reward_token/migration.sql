-- Add rewardToken dimension to quest reward system.
-- Allows a campaign to pay rewards in CC (default, existing) OR USDCx.
-- Claim fee stays CC. rewardToken only controls the REWARD token.
--
-- DEFAULT "CC" → semua quest/winner/completion existing tidak berubah behavior (backward-compat).

-- Quest: token yang dipilih admin saat membuat campaign.
ALTER TABLE "Quest" ADD COLUMN "rewardToken" TEXT NOT NULL DEFAULT 'CC';
COMMENT ON COLUMN "Quest"."rewardToken" IS 'Token reward: "CC" (Amulet, default) atau "USDCx". Fee claim tetap CC.';

-- WinnerDraw: mirror Quest.rewardToken saat slot di-reserve (FCFS/draw/raffle).
ALTER TABLE "WinnerDraw" ADD COLUMN "rewardToken" TEXT NOT NULL DEFAULT 'CC';
COMMENT ON COLUMN "WinnerDraw"."rewardToken" IS 'Token reward winner: "CC" (default) atau "USDCx". Mirror Quest.rewardToken.';

-- QuestCompletion: token reward + amount terpisah (USDCx pakai Decimal, bukan micro-CC).
ALTER TABLE "QuestCompletion" ADD COLUMN "rewardToken" TEXT NOT NULL DEFAULT 'CC';
ALTER TABLE "QuestCompletion" ADD COLUMN "rewardTokenAmount" DECIMAL(38,18);
COMMENT ON COLUMN "QuestCompletion"."rewardToken" IS 'Token reward completion: "CC" (default, pakai rewardMicroCc) atau "USDCx" (pakai rewardTokenAmount).';
COMMENT ON COLUMN "QuestCompletion"."rewardTokenAmount" IS 'Jumlah token non-CC (USDCx) yang dikredit. Null = CC (pakai rewardMicroCc).';

-- TokenTxType: tambah QUEST_REWARD untuk history reward token non-CC (paralel CcTransactionType.QUEST_REWARD).
ALTER TYPE "TokenTxType" ADD VALUE 'QUEST_REWARD';
