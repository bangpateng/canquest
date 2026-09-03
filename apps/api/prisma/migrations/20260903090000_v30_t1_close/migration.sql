-- v30 Tahap 1: penutupan pendaftaran T1 (70% durasi) — flag per-quest.
ALTER TABLE "Quest" ADD COLUMN "v30RegistrationClosedAt" TIMESTAMP(3);
CREATE INDEX "Quest_v30RegistrationClosedAt_idx" ON "Quest"("v30RegistrationClosedAt");
