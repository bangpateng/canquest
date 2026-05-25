"use client";

import Link from "next/link";
import { QuestsBrowser, type EarnCampaignStats } from "@/components/app/quests-browser";
import { ROUTES } from "@/lib/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { cn } from "@/lib/utils";
import { ArrowRight, CheckCircle2, Gift, ListChecks, Sparkles, Trophy, Zap } from "lucide-react";
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

  const statItems = [
    {
      key: "live",
      label: t("earnCampaigns.live"),
      value: stats.active,
      icon: Zap,
      accent: "text-canton",
    },
    {
      key: "done",
      label: t("earnCampaigns.completed"),
      value: stats.completed,
      icon: CheckCircle2,
      accent: "text-emerald-400",
    },
    {
      key: "all",
      label: t("earnCampaigns.total"),
      value: stats.total,
      icon: ListChecks,
      accent: "text-[var(--foreground)]",
    },
  ] as const;

  return (
    <div className="space-y-6">
      <section
        className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/50"
        aria-label={t("earnCampaigns.statsAria")}
      >
        <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
          {statItems.map(({ key, label, value, icon: Icon, accent }) => (
            <div key={key} className="px-3 py-4 text-center sm:px-5 sm:py-5">
              <Icon className={cn("mx-auto h-4 w-4", accent)} aria-hidden />
              <p className="mt-2 text-2xl font-semibold tabular-nums leading-none text-[var(--foreground)] sm:text-3xl">
                {value}
              </p>
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {label}
              </p>
            </div>
          ))}
        </div>

        {stats.total > 0 ? (
          <div className="border-t border-[var(--border)] bg-[var(--muted)]/15 px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted-foreground)]">
              <span>
                {stats.completed} / {stats.total} {t("earnCampaigns.progressCompleted")}
              </span>
              <span className="font-semibold tabular-nums text-canton">{completionPct}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)] transition-all duration-700"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
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
          </Link>
          <Link
            href={ROUTES.earnHub}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-canton transition-colors hover:text-[var(--primary-strong)]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("nav.quests")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>

      <QuestsBrowser variant="earn" onStatsChange={setStats} />
    </div>
  );
}
