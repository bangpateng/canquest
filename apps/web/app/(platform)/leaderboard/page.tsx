"use client";

import { LeaderboardTable } from "@/components/app/leaderboard/leaderboard-table";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export default function LeaderboardPage() {
  const t = usePlatformT();

  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      <PlatformPageIntro eyebrow="Leaderboard" title="Rankings" eyebrowBrand />
      <LeaderboardTable />
    </PlatformPage>
  );
}
