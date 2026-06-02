"use client";

import { LeaderboardTable } from "@/components/app/earn/leaderboard-table";
import { PlatformPage } from "@/components/platform/platform-page";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export default function LeaderboardPage() {
  const t = usePlatformT();

  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      <LeaderboardTable />
    </PlatformPage>
  );
}
