"use client";

import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/typography";
import { ROUTES } from "@/lib/routing/app-routes";
import { EarnCampaignCard } from "@/components/app/earn/earn-campaign-card";
import { getRewardConfig, type RewardIconKind } from "@/lib/quest/quest-engine";
import type { UserProgress } from "@/lib/quest/quest-types";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest/quest-types";
import {
  Calendar,
  CheckCircle2,
  Coins,
  ListChecks,
  Sparkles,
  Ticket,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";

function QuestLogo({
  logoUrl,
  orgSlug,
  completed,
}: {
  logoUrl?: string | null;
  orgSlug: string;
  completed?: boolean;
}) {
  const inner = logoUrl ? (
    <img
      src={logoUrl}
      alt=""
      className="h-full w-full object-cover"
    />
  ) : (
    <span className="type-card-title text-canton">
      {orgSlug.slice(0, 2).toUpperCase()}
    </span>
  );

  return (
    <div
      className={cn(
        "relative h-12 w-12 shrink-0 overflow-hidden rounded-xl ring-2 ring-[var(--card)]",
        completed
          ? "bg-emerald-500/15 ring-emerald-500/40"
          : "bg-[var(--muted)] ring-[var(--border)]",
      )}
    >
      <div className="flex h-full w-full items-center justify-center">{inner}</div>
      {completed && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[var(--primary-foreground)] ring-2 ring-[var(--card)]">
          <CheckCircle2 className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

/** Map reward config accentClass to reward bar gradient + icon. */
function rewardBarStyle(config: ReturnType<typeof getRewardConfig>): {
  icon: typeof Coins;
  className: string;
} {
  if (config.isCcToken) {
    return {
      icon: Coins,
      className: "from-[var(--primary)]/20 to-[rgb(var(--canton-cyan-rgb)/0.08)] border-[var(--primary)]/30 text-canton",
    };
  }
  if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM") {
    return {
      icon: Ticket,
      className: "from-violet-500/20 to-fuchsia-500/10 border-violet-500/30 text-violet-200",
    };
  }
  if (config.code === "WAITLIST_EMAIL") {
    return {
      icon: Sparkles,
      className: "from-cyan-500/15 to-blue-500/10 border-cyan-500/25 text-cyan-200",
    };
  }
  return {
    icon: Trophy,
    className: "from-[rgb(var(--canton-rgb)/0.18)] to-[rgb(var(--canton-cyan-rgb)/0.08)] border-[rgb(var(--canton-rgb)/0.28)] text-canton",
  };
}

export function QuestCard({
  quest,
  completed = false,
  variant = "default",
  userProgress = null,
}: {
  quest: Quest;
  completed?: boolean;
  variant?: "default" | "earn";
  userProgress?: UserProgress | null;
}) {
  const t = usePlatformT();
  const isEarn = variant === "earn";

  if (isEarn) {
    return (
      <EarnCampaignCard
        quest={quest}
        completed={completed}
        userProgress={userProgress}
      />
    );
  }

  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const config = getRewardConfig(quest.rewardType);
  const accent = rewardBarStyle(config);
  const RewardIcon = accent.icon;

  const ctaLabel =
    quest.status === "ENDED"
      ? t("quests.viewRecap")
      : completed
        ? t("quests.questComplete")
        : t("quests.joinQuest");

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-3xl transition-all duration-300",
        "bg-[var(--card)] ring-1 ring-white/5",
        "hover:-translate-y-1 hover:ring-[var(--primary)]/25 hover:shadow-[0_0_40px_rgb(var(--canton-rgb)/0.08)]",
        quest.status === "ENDED" && "opacity-90",
        quest.status === "COMING_SOON" && "opacity-95",
      )}
    >
      {/* Hover glow border */}
      <div
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(135deg, rgb(var(--canton-rgb) / 0.12) 0%, transparent 40%, rgb(167 139 250 / 0.08) 100%)",
        }}
      />

      {/* Hero */}
      <div
        className={cn(
          "relative shrink-0 overflow-hidden",
          "h-36",
        )}
      >
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
          style={
            quest.bannerImageUrl
              ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
              : { background: quest.banner }
          }
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-[var(--card)]/40 to-[var(--card)]" />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, rgb(var(--canton-rgb) / 0.06) 50%, transparent 100%)",
          }}
        />

        {/* Status chip */}
        <span
          className={cn(
            "absolute right-4 top-4 z-[2] rounded-xl px-3 py-1.5 text-xs font-bold uppercase tracking-wider backdrop-blur-md",
            statusMeta.className,
          )}
        >
          {statusMeta.label}
        </span>

        {/* Tags */}
        {quest.tags.length > 0 && (
          <div className="absolute bottom-3 left-4 right-16 z-[2] flex flex-wrap gap-1.5">
            {quest.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div
        className={cn(
          "relative flex flex-1 flex-col px-6 pb-6 pt-0",
        )}
      >
        {/* Logo overlap */}
        <div className="-mt-7 mb-3 flex items-end gap-4">
          <QuestLogo
            logoUrl={quest.logoUrl}
            orgSlug={quest.orgSlug}
            completed={completed}
          />
          <div className="min-w-0 flex-1 pb-1">
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-slate-400">
              {quest.org}
            </p>
            <CardTitle
              className={cn(
                "line-clamp-2 text-xl font-bold text-slate-100",
              )}
            >
              {quest.title}
            </CardTitle>
          </div>
        </div>

        <p
          className={cn(
            "line-clamp-2 leading-relaxed text-slate-400",
            "text-sm font-medium",
          )}
        >
          {quest.description}
        </p>

        {/* Meta chips */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-2xl border border-white/5 bg-[var(--muted)]/60 px-3 py-1.5 text-sm font-medium text-slate-400">
            <ListChecks className="h-4 w-4 shrink-0 text-canton" />
            {quest.tasks.length} tasks
          </span>
          {quest.deadline && (
            <span className="inline-flex items-center gap-2 rounded-2xl border border-white/5 bg-[var(--muted)]/60 px-3 py-1.5 text-sm font-medium text-slate-400">
              <Calendar className="h-4 w-4 shrink-0" />
              {quest.deadline}
            </span>
          )}
        </div>

        <div
          className={cn(
            "mt-4 flex items-center gap-3 rounded-2xl border bg-gradient-to-r px-4 py-3",
            accent.className,
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/20">
            <RewardIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
              {t("earnCampaigns.rewardLabel")}
            </p>
            <p className="truncate text-base font-bold text-slate-100">{quest.rewardPool}</p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-6 pt-4">
        {canOpen ? (
          <Link
            href={ROUTES.campaignQuest(quest.id, quest.title)}
            className={cn(
              buttonVariants({
                size: "block",
                variant:
                  quest.status === "ENDED"
                    ? "secondary"
                    : completed
                      ? "success"
                      : "primary",
              }),
              "py-3.5",
            )}
          >
            {ctaLabel}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-800/80 bg-[var(--muted)]/40 py-3 text-base font-semibold text-slate-400"
          >
            Opens soon
          </button>
        )}
        </div>
      </div>
    </article>
  );
}
