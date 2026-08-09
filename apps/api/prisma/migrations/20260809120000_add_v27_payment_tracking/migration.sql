-- v27: DAML AppPaymentRequest reward flow tracking.
--
-- WinnerDraw: +6 kolom nullable untuk track lifecycle reward v27.
-- Semua nullable → zero-risk migration (existing rows NULL, v25 flow tidak terdampak).
--
-- Routing v27 (saat QUEST_V27_FLOW=true):
--   CC + preapproval ON  → PATH A (PlatformTransfer.ExecuteTransfer, instan)
--   USDCx / CC no preapproval → PATH B (AppPaymentRequest → Accept → Collect)
--
-- rewardPath: 'V25_SETTLE' | 'V27_PATH_A' | 'V27_PATH_B' | 'LEGACY'
-- questPaymentRequestCid: DAML wrapper QuestPaymentRequest contractId (PATH A & B)
-- appPaymentRequestCid: Splice AppPaymentRequest / AcceptedAppPayment contractId (PATH B only)
-- paymentAcceptedAt: timestamp saat AppPaymentRequest di-accept (PATH B)
-- paymentCollectedAt: timestamp saat AcceptedAppPayment_Collect sukses (PATH B)
-- paymentExpiredReason: 'TIMEOUT'|'REJECTED'|'WITHDRAWN'|'CANCELLED' (PATH B failure)

ALTER TABLE "WinnerDraw" ADD COLUMN "rewardPath" TEXT;
ALTER TABLE "WinnerDraw" ADD COLUMN "questPaymentRequestCid" TEXT;
ALTER TABLE "WinnerDraw" ADD COLUMN "appPaymentRequestCid" TEXT;
ALTER TABLE "WinnerDraw" ADD COLUMN "paymentAcceptedAt" TIMESTAMP(3);
ALTER TABLE "WinnerDraw" ADD COLUMN "paymentCollectedAt" TIMESTAMP(3);
ALTER TABLE "WinnerDraw" ADD COLUMN "paymentExpiredReason" TEXT;

COMMENT ON COLUMN "WinnerDraw"."rewardPath" IS 'v27: reward flow path taken. V25_SETTLE|V27_PATH_A|V27_PATH_B|LEGACY. Null = pre-v27 rows.';
COMMENT ON COLUMN "WinnerDraw"."questPaymentRequestCid" IS 'v27: DAML QuestPaymentRequest wrapper contractId (audit trail on-chain).';
COMMENT ON COLUMN "WinnerDraw"."appPaymentRequestCid" IS 'v27 PATH B: Splice AppPaymentRequest → AcceptedAppPayment contractId.';
COMMENT ON COLUMN "WinnerDraw"."paymentAcceptedAt" IS 'v27 PATH B: timestamp AppPaymentRequest_Accept sukses.';
COMMENT ON COLUMN "WinnerDraw"."paymentCollectedAt" IS 'v27 PATH B: timestamp AcceptedAppPayment_Collect sukses.';
COMMENT ON COLUMN "WinnerDraw"."paymentExpiredReason" IS 'v27 PATH B failure: TIMEOUT|REJECTED|WITHDRAWN|CANCELLED.';

-- Index: scan WinnerDraw untuk timeout scheduler (PATH B stuck in PENDING/ACCEPTED).
CREATE INDEX "WinnerDraw_rewardPath_distributed_idx" ON "WinnerDraw"("rewardPath", "distributed");
