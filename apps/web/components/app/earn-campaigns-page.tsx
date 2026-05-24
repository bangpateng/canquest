"use client";

import Link from "next/link";
import { QuestsBrowser } from "@/components/app/quests-browser";
import { PageHeader } from "@/components/ui/typography";
import { ROUTES } from "@/lib/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { ArrowRight, Gift, Sparkles, Trophy } from "lucide-react";
import { useState } from "react";

type EarnCampaignStats = {
  active: number;
  completed: number;
  total: number;
};

export function EarnCampaignsPage() {
  const t = usePlatformT();
  const [stats, setStats] = useState<EarnCampaignStats>({
    active: 0,
    completed: 0,
    total: 0,
  });

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title={t("earnCampaigns.title")}
        description={
          <>
            {t("earnCampaigns.description")}{" "}
            <Link
              href={ROUTES.earnHub}
              className="font-medium text-canton underline-offset-2 hover:underline"
            >
              {t("nav.quests")}
            </Link>
            .
          </>
        }
      />

      <section
        className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/40"
        aria-label={t("earnCampaigns.statsAria")}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3 sm:px-5">
          <p className="text-xs font-medium text-[var(--muted-foreground)]">
            {t("earnCampaigns.statsLabel")}
          </p>
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-canton">
            <Sparkles className="h-3 w-3" aria-hidden />
            {t("earnCampaigns.live")}
          </span>
        </div>

        <div className="relative grid gap-px bg-[var(--border)] sm:grid-cols-3">
          <div className="relative bg-[var(--card)]/80 px-4 py-4 sm:px-5">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_0%_0%,rgb(var(--canton-rgb)/0.1),transparent_60%)]"
              aria-hidden
            />
            <p className="relative text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t("earnCampaigns.active")}
            </p>
            <p className="relative mt-1 text-3xl font-semibold tabular-nums text-[var(--foreground)]">
              {stats.active}
            </p>
          </div>
          <div className="relative bg-[var(--card)]/80 px-4 py-4 sm:px-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t("earnCampaigns.completed")}
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-emerald-400/90">
              {stats.completed}
            </p>
          </div>
          <div className="relative bg-[var(--card)]/80 px-4 py-4 sm:px-5">
            <div
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_100%_0%,rgb(167_139_250/0.12),transparent_60%)]"
              aria-hidden
            />
            <p className="relative text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {t("earnCampaigns.total")}
            </p>
            <p className="relative mt-1 text-3xl font-semibold tabular-nums text-[var(--foreground)]">
              {stats.total}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)]/80 bg-[var(--muted)]/10 px-4 py-3 sm:px-5">
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

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/40">
        <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3 sm:px-5">
          <p className="text-xs font-medium text-[var(--muted-foreground)]">
            {t("earnCampaigns.campaignsHeader")}
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <QuestsBrowser embedded onStatsChange={setStats} />
        </div>
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
