-- v32: Email notifikasi campaign (Resend) — outbox pattern + preference unsubscribe.
--
-- Hook admin (createQuest / drawWinners / updateQuest→ENDED) membuat baris
-- PENDING; worker Bull queue `email-jobs` kirim via Resend batch + update status.
-- Unique [userId, questId, type] = idempotency anti dobel kirim (draw bertahap aman).

-- Enum jenis email & status kirim.
CREATE TYPE "EmailNotificationType" AS ENUM ('CAMPAIGN_ANNOUNCEMENT', 'CAMPAIGN_WINNER', 'CAMPAIGN_NOT_SELECTED');
CREATE TYPE "EmailNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- User preference: kill-switch per-user untuk email campaign.
-- Target link "Manage email preferences" di footer email (PATCH /users/me/preferences).
ALTER TABLE "User" ADD COLUMN "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Outbox table.
CREATE TABLE "EmailNotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "type" "EmailNotificationType" NOT NULL,
    "status" "EmailNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "resendId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailNotificationLog_pkey" PRIMARY KEY ("id")
);

-- Idempotency: 1 email per (user, quest, type) — hook retry / draw bertahap
-- tidak mengirim ulang untuk user yang sama.
CREATE UNIQUE INDEX "EmailNotificationLog_userId_questId_type_key" ON "EmailNotificationLog"("userId", "questId", "type");

-- FK ke User (cascade saat user dihapus).
ALTER TABLE "EmailNotificationLog" ADD CONSTRAINT "EmailNotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lookup worker: ambil PENDING rows per (quest, type); audit status feed.
CREATE INDEX "EmailNotificationLog_questId_type_status_idx" ON "EmailNotificationLog"("questId", "type", "status");
CREATE INDEX "EmailNotificationLog_status_createdAt_idx" ON "EmailNotificationLog"("status", "createdAt");
