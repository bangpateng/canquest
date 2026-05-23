"use client";

import { LeaderboardTable } from "@/components/app/leaderboard-table";
import { PageHeader } from "@/components/ui/typography";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export default function LeaderboardPage() {
  const t = usePlatformT();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={t("leaderboard.title")}
        description={t("leaderboard.description")}
      />
      <LeaderboardTable />
    </div>
  );
}
