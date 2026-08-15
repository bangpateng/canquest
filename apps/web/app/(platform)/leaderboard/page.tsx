"use client";

import { LeaderboardTable } from "@/components/app/leaderboard/leaderboard-table";
import { PlatformPage } from "@/components/platform/platform-page";

export default function LeaderboardPage() {

  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      <LeaderboardTable />
    </PlatformPage>
  );
}
