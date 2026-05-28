"use client";

import { buttonVariants } from "@/components/ui/button";
import { ROUTES } from "@/lib/app-routes";
import { campaignUiKind } from "@/lib/campaign-reward";
import { QUEST_STATUS_BADGE, type Quest, type RewardType } from "@/lib/quest-types";
import { cn } from "@/lib/utils";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { Coins, Sparkles, Ticket, Trophy } from "lucide-react";
import Link from "next/link";

function rewardAccent(rewardPool: string, rewardType?: RewardType) {
  const pool = rewardPool.toLowerCase();
  if (
    rewardType === "CC_ONLY" ||
    rewardType === "CC_MANUAL" ||
    rewardType === "CC_AND_INVITE" ||
    pool.includes("cc")
  ) {
    return {
      icon: Coins,
      footer: "from-[var(--primary)]/10 via-transparent to-transparent border-[var(--primary)]/20",
      value: "text-canton",
    };
  }
  if (rewardType?.includes("INVITE") || pool.includes("invite") || pool.includes("fcfs")) {
    return {
      icon: Ticket,
      footer: "from-violet-500/10 via-transparent to-transparent border-violet-500/20",
      value: "text-violet-200",
    };
  }
  if (rewardType === "WAITLIST_EMAIL" || pool.includes("waitlist")) {
    return {
      icon: Sparkles,
      footer: "from-cyan-500/10 via-transparent to-transparent border-cyan-500/15",
      value: "text-cyan-200",
    };
  }
  return {
    icon: Trophy,
    footer: "from-[rgb(var(--canton-rgb)/0.08)] via-transparent to-transparent border-[var(--border)]",
    value: "text-canton",
  };
}

function kindLabel(
  kind: ReturnType<typeof campaignUiKind>,
  rewardType: string | undefined,
  t: (key: string) => string,
): string {
  switch (kind) {
    case "cc_fcfs":
      return t("earnCampaigns.kindFcfs");
    case "cc_manual_draw":
      return t("earnCampaigns.kindCcRaffle");
    case "cc_manual":
      return t("earnCampaigns.kindCc");
    case "waitlist_code":
      return rewardType === "INVITE_CODE_FCFS"
        ? t("earnCampaigns.kindInvite")
        : t("earnCampaigns.kindRaffle");
    case "waitlist_email":
      return t("earnCampaigns.kindWaitlist");
    default:
      return t("earnCampaigns.kindCampaign");
  }
}

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

export function EarnCampaignRow({
  quest,
  completed = false,
}: {
  quest: Quest;
  completed?: boolean;
}) {
  const t = usePlatformT();
  const canOpen = quest.status === "ACTIVE" || quest.status === "ENDED";
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const poolLower = quest.rewardPool.toLowerCase();
  const requiresFcfs =
    poolLower.includes("fcfs") ||
    poolLower.includes("first come") ||
    quest.rewardType === "INVITE_CODE_FCFS";
  const uiKind = campaignUiKind(quest.rewardType, requiresFcfs);
  const accent = rewardAccent(quest.rewardPool, quest.rewardType);

  const ctaLabel =
    quest.status === "ENDED"
      ? t("quests.viewRecap")
      : completed
        ? t("quests.questComplete")
        : t("quests.joinQuest");

  const metaParts = [
    kindLabel(uiKind, quest.rewardType, t),
    `${quest.tasks.length} tasks`,
    quest.deadline ?? null,
  ].filter(Boolean) as string[];

  return (
    <li>
      <article
        className={cn(
          "group relative overflow-hidden rounded-2xl border transition-all duration-300",
          completed
            ? "border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.06] to-[var(--card)]/90"
            : "border-[var(--border)] bg-[var(--card)]/60 hover:border-[var(--primary)]/20 hover:bg-[var(--card)]/90",
          quest.status === "COMING_SOON" && "opacity-90",
        )}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />

        <div className="p-4 sm:p-5">
          {/* Header */}
          <div className="flex gap-3.5 sm:gap-4">
          <CampaignLogo quest={quest} />

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pr-2">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                    {quest.org}
                  </p>
                  <h3 className="type-card-title mt-1 line-clamp-1 text-[var(--foreground)] sm:text-base">
                    {quest.title}
                  </h3>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                    statusMeta.className,
                  )}
                >
                  {statusMeta.label}
                </span>
              </div>

              <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
                {quest.description}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                  {metaParts.join(" · ")}
                </p>

                {canOpen ? (
                  <Link
                    href={ROUTES.campaignQuest(quest.id, quest.title)}
                    className={cn(
                      buttonVariants({
                        size: "sm",
                        variant: completed ? "success" : "primary",
                      }),
                      "shrink-0 px-5 font-bold",
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
                      "shrink-0 cursor-not-allowed rounded-full opacity-50",
                    )}
                  >
                    Soon
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Reward footer */}
        {canOpen ? (
          <Link
            href={ROUTES.campaignQuest(quest.id, quest.title)}
            className={cn(
              "flex items-center gap-3 border-t bg-gradient-to-r px-4 py-3 transition-colors sm:px-5",
              accent.footer,
              "hover:bg-[var(--muted)]/10",
            )}
          >
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
              {t("earnCampaigns.rewardLabel")}
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", accent.value)}>
              {quest.rewardPool}
            </span>
            <span className="inline-flex shrink-0 items-center text-xs font-semibold text-[var(--foreground)]/80 transition-colors group-hover:text-canton">
              {t("quests.viewQuest")}
            </span>
          </Link>
        ) : (
          <div
            className={cn(
              "flex items-center gap-3 border-t bg-gradient-to-r px-4 py-3 sm:px-5",
              accent.footer,
            )}
          >
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
              {t("earnCampaigns.rewardLabel")}
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", accent.value)}>
              {quest.rewardPool}
            </span>
          </div>
        )}
      </article>
    </li>
  );
}
