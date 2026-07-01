-- Per-event Earn access gate (configurable from admin dashboard).
-- entryGateMode: mode gate per-campaign. CC_OR_POINTS (default) = lock CC atau spend points (perilaku lama).
--                CC_ONLY / POINTS_ONLY / NONE = admin pilih per-event.
-- entryCcLock: override jumlah CC yang harus di-lock (null = pakai default global LOCK_TIER_FULL, 30).
-- entryCostPoints: override biaya points (null = pakai default global earn_entry_cost_points AppSetting / 200).
-- Nullable = backward-compatible: event lama & event baru yang tak diset tetap berperilaku sama.

-- Enum tipe gate akses Earn.
CREATE TYPE "EntryGateMode" AS ENUM ('CC_OR_POINTS', 'CC_ONLY', 'POINTS_ONLY', 'NONE');

-- Default CC_OR_POINTS mempertahankan perilaku lama untuk semua event existing.
ALTER TABLE "Quest" ADD COLUMN "entryGateMode" "EntryGateMode" NOT NULL DEFAULT 'CC_OR_POINTS';
ALTER TABLE "Quest" ADD COLUMN "entryCcLock" INTEGER;
ALTER TABLE "Quest" ADD COLUMN "entryCostPoints" INTEGER;
