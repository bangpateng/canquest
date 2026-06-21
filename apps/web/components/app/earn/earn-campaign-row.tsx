"use client";

import { buttonVariants } from "@/components/ui/button";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { CcUsdValue } from "@/components/app/earn/cc-usd-value";
import { ROUTES } from "@/lib/routing/app-routes";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { QUEST_STATUS_BADGE, type Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Coins, ListChecks, Sparkles, Ticket, Trophy } from "lucide-react";
import Link from "next/link";

function CampaignLogo({ quest }: { quest: Quest }) {
  return (
    <div
      className="relative h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-[var(--muted)]/80"
    >
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
  size = 12,
}: {
  config: ReturnType<typeof getQuestMeta>["config"];
  size?: number;
}) {
  if (config.isCcToken) return <CcRewardLogo size={size} />;
  if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM")
    return <Ticket className="h-3 w-3 shrink-0" aria-hidden />;
  if (config.code === "WAITLIST_EMAIL")
    return <Sparkles className="h-3 w-3 shrink-0" aria-hidden />;
  return <Trophy className="h-3 w-3 shrink-0" aria-hidden />;
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
  const { config } = meta;

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
          "group relative overflow-hidden rounded-3xl border transition-all duration-300",
          completed
            ? "border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.06] to-[var(--card)]/90"
            : "border-white/5 bg-[var(--card)]/60 hover:border-[var(--primary)]/20 hover:bg-[var(--card)]/90",
          quest.status === "COMING_SOON" && "opacity-90",
        )}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />

        <div className="p-6">
          {/* Header */}
          <div className="flex gap-5">
            <CampaignLogo quest={quest} />

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-4">
                {/* Org + Title */}
                <div className="min-w-0 pr-3">
                  <p className="truncate text-xs font-semibold text-slate-400">
                    {quest.org}
                  </p>
                  <h3 className="mt-1 line-clamp-1 text-lg font-bold text-slate-100 sm:text-xl">
                    {quest.title}
                  </h3>
                </div>

                {/* Status + Type badges stacked */}
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span
                    className={cn(
                      "rounded-xl px-3 py-1 text-xs font-bold uppercase tracking-wide",
                      statusMeta.className,
                    )}
                  >
                    {statusMeta.label}
                  </span>
                  <span
                    className={cn(
                      "rounded-xl border px-3 py-1 text-xs font-bold uppercase tracking-wide",
                      config.chipClass,
                    )}
                  >
                    {config.shortLabel}
                  </span>
                </div>
              </div>

              {/* Description */}
              <p className="mt-3 line-clamp-2 text-sm font-medium leading-relaxed text-slate-400">
                {quest.description}
              </p>

              {/* Meta row: tasks + type info left, reward pill + CTA right */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                {/* Left: tasks count */}
                <div className="flex flex-wrap items-center gap-3 text-sm font-medium text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <ListChecks className="h-4 w-4 text-canton" aria-hidden />
                    {quest.tasks.length} tasks
                  </span>
                  {quest.deadline ? (
                    <span className="text-slate-500">{quest.deadline}</span>
                  ) : null}
                  {/* Reward pill */}
                  <div className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/30 px-2.5 py-1 text-xs font-bold",
                    config.accentClass,
                  )}>
                    <RewardPillIcon config={config} size={12} />
                    <span className="truncate">{rewardPillText}</span>
                  </div>
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
                      "shrink-0 px-6 font-bold",
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
                      "shrink-0 cursor-not-allowed rounded-2xl opacity-50",
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
