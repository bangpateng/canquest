"use client";

import { LeaderboardTable } from "@/components/app/leaderboard-table";
import { PlatformPage, PlatformPageIntro } from "@/components/platform/platform-page";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export default function LeaderboardPage() {
  const t = usePlatformT();

  return (
    <PlatformPage>
      <PlatformPageIntro
        title={t("leaderboard.title")}
        description={t("leaderboard.description")}
      />
      <LeaderboardTable />
    </PlatformPage>
  );
}
