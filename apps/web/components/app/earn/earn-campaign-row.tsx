"use client";

import { buttonVariants } from "@/components/ui/button";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { ROUTES } from "@/lib/routing/app-routes";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Calendar, ListChecks, Sparkles, Ticket, Trophy, Users } from "lucide-react";
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

/** Compact status dot — merges status into a minimal visual. */
function StatusDot({ quest }: { quest: Quest }) {
  const color =
    quest.status === "ACTIVE" ? "bg-emerald-400"
      : quest.status === "COMING_SOON" ? "bg-cyan-400"
        : "bg-slate-500";
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {quest.status === "ACTIVE" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
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
  const statusMeta = QUEST_STATUS_BADGE[quest.status];

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
            : "border-white/[0.06] bg-[#0a0c14]/80 hover:border-[rgb(var(--canton-rgb)/0.25)] hover:bg-[#0a0c14]/95 backdrop-blur-xl",
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
              <div className="flex items-start justify-between gap-3">
                {/* Org + Title + status dot */}
                <div className="min-w-0 pr-2">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <StatusDot quest={quest} />
                    <span className="truncate text-xs font-semibold text-slate-400">
                      {statusMeta.label} · {quest.org}
                    </span>
                  </div>
                  <h3 className="line-clamp-1 text-base font-bold text-slate-100 sm:text-lg">
                    {quest.title}
                  </h3>
                </div>

                {/* Type chip */}
                <span
                  className={cn(
                    "shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                    config.chipClass,
                  )}
                >
                  {config.shortLabel}
                </span>
              </div>

              {/* Description */}
              <p className="mt-2 line-clamp-2 text-sm font-medium leading-relaxed text-slate-400">
                {quest.description}
              </p>

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
