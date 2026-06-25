"use client";

import { buttonVariants } from "@/components/ui/button";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { ROUTES } from "@/lib/routing/app-routes";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Calendar, ListChecks, Sparkles, Tag, Ticket, Trophy, Users } from "lucide-react";
import Link from "next/link";

function CampaignLogo({ quest }: { quest: Quest }) {
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[var(--muted)]/80 ring-1 ring-white/10 sm:h-14 sm:w-14">
      {quest.logoUrl ? (
        <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-sm font-bold text-canton">
          {quest.orgSlug.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

/** Reward pill icon for row view */
function RewardPillIcon({
  config,
  size = 14,
}: {
  config: ReturnType<typeof getQuestMeta>["config"];
  size?: number;
}) {
  if (config.isCcToken) return <CcRewardLogo size={size} />;
  if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM")
    return <Ticket className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  if (config.code === "WAITLIST_EMAIL")
    return <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  return <Trophy className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}

/** Status badge — consistent with card view. */
function StatusBadge({ quest }: { quest: Quest }) {
  const isActive = quest.status === "ACTIVE";
  const isComing = quest.status === "COMING_SOON";
  const label = QUEST_STATUS_BADGE[quest.status].label;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider backdrop-blur-md",
        isActive && "border border-emerald-500/25 bg-emerald-500/15 text-emerald-300",
        isComing && "border border-cyan-500/25 bg-cyan-500/15 text-cyan-300",
        !isActive && !isComing && "border border-white/10 bg-white/5 text-slate-300",
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isActive && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
        )}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            isActive ? "bg-emerald-400" : isComing ? "bg-cyan-400" : "bg-slate-500",
          )}
        />
      </span>
      {label}
    </span>
  );
}

export function EarnCampaignRow({
  quest,
  completed = false,
}: {
  quest: Quest;
  completed?: boolean;
}) {
  const t = usePlatformT();

  // ── Derive all UI state from quest-engine ─────────────────────
  const meta = getQuestMeta(quest);
  const { config, slots } = meta;

  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";

  const ctaLabel =
    quest.status === "ENDED"
      ? t("quests.viewRecap")
      : completed
        ? t("quests.questComplete")
        : t("quests.joinQuest");

  // Reward pill text (sentence case)
  let rewardPillText: string;
  if (config.isDual) {
    rewardPillText = quest.rewardCc > 0 ? `${quest.rewardCc} CC + 1 Code` : "CC + 1 Code";
  } else if (config.isCcToken && quest.rewardCc > 0) {
    rewardPillText = `${quest.rewardCc} CC · winner`;
  } else if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM") {
    rewardPillText = "1 Code / winner";
  } else if (config.code === "WAITLIST_EMAIL") {
    rewardPillText = "Waitlist spot";
  } else {
    rewardPillText = quest.rewardPool ?? "—";
  }

  return (
    <li>
      <article
        className={cn(
          "group relative overflow-hidden rounded-2xl border transition-all duration-300",
          completed
            ? "border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.06] to-[var(--card)]/90"
            : "border-white/[0.06] bg-[var(--card)]/80 hover:border-[rgb(var(--canton-rgb)/0.25)] hover:bg-[var(--card)]/95 backdrop-blur-xl",
          quest.status === "COMING_SOON" && "opacity-90",
        )}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />

        <div className="p-4 sm:p-5">
          {/* Header */}
          <div className="flex gap-3 sm:gap-4">
            <CampaignLogo quest={quest} />

            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-2">
                <StatusBadge quest={quest} />
                <span className="truncate text-xs font-semibold text-slate-400">
                  {quest.org}
                </span>
              </div>
              <h3 className="line-clamp-1 text-base font-bold text-slate-100 sm:text-lg">
                {quest.title}
              </h3>

              {/* Description */}
              <p className="mt-2 line-clamp-2 text-sm font-medium leading-relaxed text-slate-400">
                {quest.description}
              </p>

              {/* Tags */}
              {quest.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {quest.tags.slice(0, 5).map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-0.5 rounded-md border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      <Tag className="h-2.5 w-2.5 shrink-0 opacity-50" aria-hidden />
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Meta row: tasks + reward pill + deadline left, CTA right */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 sm:mt-4">
                {/* Left: tasks + reward */}
                <div className="flex flex-wrap items-center gap-2.5 text-sm font-medium text-slate-400 sm:gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <ListChecks className="h-4 w-4 text-canton" aria-hidden />
                    {quest.tasks.length} tasks
                  </span>
                  <div className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/30 px-2.5 py-1 text-xs font-bold",
                    config.accentClass,
                  )}>
                    <RewardPillIcon config={config} size={14} />
                    <span className="truncate max-w-[140px]">{rewardPillText}</span>
                  </div>
                  {slots.max > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Users className="h-3.5 w-3.5" />
                      {slots.max} {config.isFcfs ? "slots" : "winners"}
                    </span>
                  ) : null}
                  {quest.deadline ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Calendar className="h-3.5 w-3.5" />
                      <span className="truncate max-w-[100px]">{quest.deadline}</span>
                    </span>
                  ) : null}
                </div>

                {/* CTA */}
                {canOpen ? (
                  <Link
                    href={ROUTES.campaignQuest(quest.id, quest.title)}
                    className={cn(
                      buttonVariants({
                        size: "sm",
                        variant: completed ? "success" : "primary",
                      }),
                      "shrink-0 px-5 font-bold sm:px-6",
                    )}
                  >
                    {ctaLabel}
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                      "shrink-0 cursor-not-allowed rounded-xl opacity-50",
                    )}
                  >
                    Soon
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </article>
    </li>
  );
}
