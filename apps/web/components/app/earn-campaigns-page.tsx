"use client";

import Link from "next/link";
import { QuestsBrowser, type EarnCampaignStats } from "@/components/app/quests-browser";
import { PageHeader, SubsectionTitle } from "@/components/ui/typography";
import { ROUTES } from "@/lib/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils";
import { ArrowRight, Gift, Trophy, Zap } from "lucide-react";
import { useState } from "react";

export function EarnCampaignsPage() {
  const t = usePlatformT();
  const [stats, setStats] = useState<EarnCampaignStats>({
    active: 0,
    completed: 0,
    total: 0,
  });

  const completionPct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t("earnCampaigns.title")} />

      {/* Mission-style progress — matches campaign quest detail */}
      <section
        className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-5 md:p-6"
        aria-label={t("earnCampaigns.statsAria")}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "type-section-title flex h-12 w-12 items-center justify-center rounded-xl",
                stats.completed > 0
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_0_20px_rgb(var(--canton-rgb)/0.3)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]",
              )}
            >
              {completionPct}%
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                {t("earnCampaigns.statsLabel")}
              </p>
              <SubsectionTitle>
                {stats.completed} / {stats.total} {t("earnCampaigns.progressCompleted")}
              </SubsectionTitle>
              <p className="text-xs text-[var(--muted-foreground)]">
                {stats.active} {t("earnCampaigns.active")}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-canton">
            <Zap className="h-3 w-3" aria-hidden />
            {t("earnCampaigns.live")}
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--muted)] ring-1 ring-[var(--border)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)] transition-all duration-700 ease-out shadow-[0_0_12px_rgb(var(--canton-rgb)/0.5)]"
            style={{ width: `${completionPct}%` }}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)]/80 pt-4">
          <Link
            href={ROUTES.leaderboard}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)]/60 px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/35 hover:bg-[var(--primary)]/8"
          >
            <Trophy className="h-3.5 w-3.5 text-canton" />
            {t("overview.leaderboard")}
          </Link>
          <Link
            href={ROUTES.spinReward}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)]/60 px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--border)] hover:text-[var(--foreground)]"
          >
            <Gift className="h-3.5 w-3.5 text-canton" />
            {t("nav.spin")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>

      <section>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          {t("earnCampaigns.campaignsHeader")}
        </p>
        <QuestsBrowser variant="earn" onStatsChange={setStats} />
      </section>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 px-4 py-3.5 text-sm">
        <Link
          href={ROUTES.earnHub}
          className="font-medium text-[var(--foreground)] transition-colors hover:text-canton"
        >
          {t("nav.quests")}
        </Link>
        <Link
          href={ROUTES.earnHub}
          className="group flex items-center gap-1 text-xs font-semibold text-canton transition-colors hover:text-[var(--primary-strong)]"
        >
          {t("earnCampaigns.dailyTasks")}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
