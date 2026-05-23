"use client";

import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  Coins,
  ListChecks,
  Sparkles,
  Ticket,
  Trophy,
} from "lucide-react";
import { ROUTES } from "@/lib/app-routes";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest-types";
import { cn } from "@/lib/utils";

export type LandingQuestCardVariant = "spotlight" | "cinematic";

function questRewardTheme(rewardPool: string, rewardType?: string) {
  const pool = rewardPool.toLowerCase();
  if (rewardType === "CC_ONLY" || rewardType === "CC_AND_INVITE" || pool.includes("cc")) {
    return {
      glow: "from-[var(--primary)]/30 via-[rgb(var(--canton-cyan-rgb)/0.08)] to-transparent",
      badge: "bg-canton-subtle text-canton border-canton-muted",
      icon: Coins,
      accent: "text-canton",
    };
  }
  if (rewardType?.includes("INVITE") || pool.includes("invite") || pool.includes("fcfs")) {
    return {
      glow: "from-violet-500/25 via-fuchsia-500/10 to-transparent",
      badge: "bg-violet-500/15 text-violet-200 border-violet-500/30",
      icon: Ticket,
      accent: "text-violet-300",
    };
  }
  if (rewardType === "WAITLIST_EMAIL" || pool.includes("waitlist")) {
    return {
      glow: "from-cyan-500/20 via-blue-500/10 to-transparent",
      badge: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
      icon: Sparkles,
      accent: "text-cyan-300",
    };
  }
  return {
    glow: "from-[rgb(var(--canton-rgb)/0.18)] via-[rgb(var(--canton-cyan-rgb)/0.08)] to-transparent",
    badge: "bg-[rgb(var(--canton-rgb)/0.14)] text-canton border-[rgb(var(--canton-rgb)/0.28)]",
    icon: Trophy,
    accent: "text-canton",
  };
}

function QuestMark({ quest, size = "md" }: { quest: Quest; size?: "md" | "lg" }) {
  const text = quest.orgSlug.slice(0, 2).toUpperCase();
  if (quest.logoUrl) {
    return (
      <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
    );
  }
  return (
    <span
      className={cn(
        "text-canton",
        size === "lg" ? "type-section-title" : "type-card-title",
      )}
    >
      {text}
    </span>
  );
}

function CardWrap({
  quest,
  canOpen,
  children,
}: {
  quest: Quest;
  canOpen: boolean;
  children: React.ReactNode;
}) {
  if (!canOpen) {
    return <div className="cursor-default">{children}</div>;
  }
  return (
    <Link
      href={ROUTES.campaignQuest(quest.id)}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {children}
    </Link>
  );
}

/** Split layout — banner + copy side by side */
function SpotlightCard({ quest }: { quest: Quest }) {
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const theme = questRewardTheme(quest.rewardPool, quest.rewardType);
  const RewardIcon = theme.icon;
  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";

  return (
    <CardWrap quest={quest} canOpen={canOpen}>
      <article
        className={cn(
          "group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]",
          "shadow-[0_24px_64px_rgb(0_0_0/0.45)] transition-all duration-500",
          "hover:border-canton-muted hover:shadow-[0_0_60px_rgb(var(--canton-rgb)/0.12)]",
        )}
      >
        <div
          className={cn(
            "pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br opacity-60 blur-3xl",
            theme.glow,
          )}
        />
        <div className="flex flex-col md:flex-row">
          <div className="relative h-40 shrink-0 overflow-hidden md:h-auto md:w-[42%] md:min-h-[240px]">
            <div
              className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
              style={
                quest.bannerImageUrl
                  ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
                  : { background: quest.banner }
              }
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)] via-[var(--card)]/20 to-transparent md:bg-gradient-to-r md:from-transparent md:via-[var(--card)]/30 md:to-[var(--card)]" />
            <div className="relative flex h-full flex-col justify-between p-5">
              <span
                className={cn(
                  "w-fit rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md",
                  statusMeta.className,
                )}
              >
                {statusMeta.label}
              </span>
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-[var(--card)]/80 ring-2 ring-[var(--border)] backdrop-blur-sm">
                <QuestMark quest={quest} size="lg" />
              </div>
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-center p-5 md:p-7 md:pl-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              {quest.org}
            </p>
            <h3 className="type-page-title mt-2">
              {quest.title}
            </h3>
            <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
              {quest.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                  theme.badge,
                )}
              >
                <RewardIcon className="h-3.5 w-3.5" />
                {quest.rewardPool}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-1 text-xs text-[var(--muted-foreground)]">
                <ListChecks className="h-3.5 w-3.5 text-canton" />
                {quest.tasks.length} tasks
              </span>
            </div>
            {canOpen ? (
              <span className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-bold text-[var(--primary-foreground)] shadow-[0_0_28px_rgb(var(--canton-rgb)/0.35)] transition-all group-hover:gap-3">
                Join quest
                <ArrowRight className="h-4 w-4" />
              </span>
            ) : (
              <span className="mt-6 text-sm font-semibold text-[var(--muted-foreground)]">
                Opens soon
              </span>
            )}
          </div>
        </div>
      </article>
    </CardWrap>
  );
}

/** Full-bleed banner with text overlay — poster / streaming style */
function CinematicCard({ quest }: { quest: Quest }) {
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const theme = questRewardTheme(quest.rewardPool, quest.rewardType);
  const RewardIcon = theme.icon;
  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";

  return (
    <CardWrap quest={quest} canOpen={canOpen}>
      <article className="group relative h-[min(340px,78vw)] overflow-hidden rounded-2xl border border-[var(--border)] md:h-[400px]">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-[1.2s] ease-out group-hover:scale-[1.04]"
          style={
            quest.bannerImageUrl
              ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
              : { background: quest.banner }
          }
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050508] via-[#050508]/55 to-[#050508]/15" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#050508]/40 via-transparent to-transparent" />

        <div className="relative flex h-full flex-col justify-between p-5 md:p-8">
          <div className="flex items-start justify-between gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur-md md:h-14 md:w-14">
              <QuestMark quest={quest} size="lg" />
            </div>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md",
                statusMeta.className,
              )}
            >
              {statusMeta.label}
            </span>
          </div>

          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">
              {quest.org}
            </p>
            <h3 className="type-hero mt-2 text-white">
              {quest.title}
            </h3>
            <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-white/70 md:text-base">
              {quest.description}
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm font-semibold backdrop-blur-md",
                  theme.accent,
                )}
              >
                <RewardIcon className="h-4 w-4" />
                {quest.rewardPool}
              </span>
              <span className="text-xs text-white/55">
                {quest.tasks.length} tasks
                {quest.deadline ? ` · ${quest.deadline}` : ""}
              </span>
            </div>

            {canOpen ? (
              <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-6 py-3 text-sm font-bold text-[var(--primary-foreground)] shadow-[0_0_40px_rgb(var(--canton-rgb)/0.4)] transition-all group-hover:gap-3 group-hover:brightness-110">
                Join quest
                <ArrowRight className="h-4 w-4" />
              </span>
            ) : (
              <span className="mt-6 inline-block rounded-full border border-dashed border-white/30 px-6 py-3 text-sm font-semibold text-white/60">
                Coming soon
              </span>
            )}
          </div>
        </div>
      </article>
    </CardWrap>
  );
}

export function LandingQuestCard({
  quest,
  variant = "cinematic",
}: {
  quest: Quest;
  variant?: LandingQuestCardVariant;
}) {
  if (variant === "spotlight") return <SpotlightCard quest={quest} />;
  return <CinematicCard quest={quest} />;
}
