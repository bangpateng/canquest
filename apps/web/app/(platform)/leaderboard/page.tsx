"use client";

import { LeaderboardTable } from "@/components/app/earn/leaderboard-table";
import { PlatformPage } from "@/components/platform/platform-page";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export default function LeaderboardPage() {
  const t = usePlatformT();

  return (
    <PlatformPage className="w-full max-w-full overflow-x-hidden">
      {/* Page Header */}
      <header className="mb-6 md:mb-8">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white font-sans">
          {t("leaderboard.title") || "Leaderboard"}
        </h1>
        <p className="mt-2 text-xs sm:text-sm text-slate-400 font-normal leading-relaxed">
          Top performers ranked by quest points and achievements
        </p>
      </header>
      
      <LeaderboardTable />
    </PlatformPage>
  );
}
