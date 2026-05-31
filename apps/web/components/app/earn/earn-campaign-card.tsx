"use client";

import Link from "next/link";
import {
  campaignUiKind,
  fcfsSlotsTaken,
  formatFcfsSlotsFilled,
  formatPoolTotalLabel,
  hasParticipatedInQuest,
  isFcfsSlotsFull,
} from "@/lib/canton/campaign-reward";
import { ROUTES } from "@/lib/routing/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { QUEST_STATUS_BADGE, type Quest, type UserProgress } from "@/lib/quest/quest-types";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import {
  Calendar,
  Coins,
  ListChecks,
  Sparkles,
  Ticket,
  Trophy,
  Users,
  Zap,
} from "lucide-react";

function rewardTheme(rewardPool: string, rewardType?: string) {
  const pool = rewardPool.toLowerCase();
  if (
    rewardType === "CC_ONLY" ||
    rewardType === "CC_MANUAL" ||
    rewardType === "CC_AND_INVITE" ||
    pool.includes("cc")
  ) {
    return {
      icon: Coins,
      isCcToken: true,
      accent: "text-canton",
      chip: "bg-canton-soft text-canton border-canton-muted",
    };
  }
  if (rewardType?.includes("INVITE") || pool.includes("invite") || pool.includes("fcfs")) {
    return {
      icon: Ticket,
      isCcToken: false,
      accent: "text-violet-300",
      chip: "bg-violet-500/15 text-violet-200 border-violet-500/25",
    };
  }
  if (rewardType === "WAITLIST_EMAIL" || pool.includes("waitlist")) {
    return {
      icon: Sparkles,
      isCcToken: false,
      accent: "text-cyan-300",
      chip: "bg-cyan-500/12 text-cyan-200 border-cyan-500/25",
    };
  }
  return {
    icon: Trophy,
    isCcToken: false,
    accent: "text-canton",
    chip: "bg-canton-soft text-canton border-canton-muted",
  };
}

function CampaignRewardIcon({
  theme,
  className,
  size = 16,
}: {
  theme: ReturnType<typeof rewardTheme>;
  className?: string;
  size?: number;
}) {
  if (theme.isCcToken) {
    return <CcRewardLogo className={className} size={size} />;
  }
  const Icon = theme.icon;
  return <Icon className={className} aria-hidden />;
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

function Metric({
  label,
  value,
  icon: Icon,
  useCcLogo,
  accent,
  muted,
}: {
  label: string;
  value: string;
  icon: typeof Coins;
  useCcLogo?: boolean;
  accent?: string;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 px-3 py-2.5 first:pl-0 last:pr-0 sm:px-4 sm:py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        {useCcLogo ? (
          <CcRewardLogo className="opacity-90" size={12} />
        ) : (
          <Icon className={cn("h-3 w-3 shrink-0 opacity-70", accent)} aria-hidden />
        )}
        <span className="truncate">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 truncate text-sm font-bold tabular-nums sm:text-base",
          muted ? "text-[var(--muted-foreground)]" : accent ?? "text-[var(--foreground)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function EarnCampaignCard({
  quest,
  completed = false,
  userProgress = null,
}: {
  quest: Quest;
  completed?: boolean;
  userProgress?: UserProgress | null;
}) {
  const t = usePlatformT();
  const summary = quest.campaignSummary;
  const poolLower = quest.rewardPool.toLowerCase();
  const isDrawCcRaffle =
    quest.rewardType === "CC_MANUAL" || Boolean(summary?.requiresDrawCcClaim);
  const isCodeReward =
    quest.rewardType === "INVITE_CODE_FCFS" ||
    quest.rewardType === "INVITE_CODE_RANDOM" ||
    quest.rewardType === "INVITE_CODE" ||
    quest.rewardType === "CC_AND_INVITE";
  const isCodeFcfs = quest.rewardType === "INVITE_CODE_FCFS";
  const requiresFcfs = isDrawCcRaffle
    ? false
    : isCodeFcfs
      ? true
      : summary?.requiresFcfsClaim ??
      (poolLower.includes("fcfs") ||
        poolLower.includes("first come") ||
        quest.rewardType === "INVITE_CODE_FCFS");
  const uiKind = campaignUiKind(quest.rewardType, requiresFcfs);
  const theme = rewardTheme(quest.rewardPool, quest.rewardType);

  const hasParticipated = hasParticipatedInQuest(quest, userProgress);
  const slotsMax = summary?.maxWinners ?? 0;
  const slotsLeft = summary?.remainingSlots ?? 0;
  const winnersDrawn = summary?.slotsTaken ?? 0;
  const slotsUsed = fcfsSlotsTaken(slotsLeft, slotsMax);
  const slotsFull =
    requiresFcfs && isFcfsSlotsFull(slotsLeft, slotsMax);
  const joinBlocked = slotsFull && !hasParticipated && quest.status === "ACTIVE";

  const canOpen =
    quest.status === "ACTIVE" || quest.status === "ENDED" || (slotsFull && hasParticipated);
  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const showFcfs =
    requiresFcfs &&
    summary != null &&
    slotsMax > 0 &&
    summary.remainingSlots != null;
  const showWaitlistEmailWinners = quest.rewardType === "WAITLIST_EMAIL" && slotsMax > 0;
  const showWaitlistRaffleWinners =
    !isDrawCcRaffle && isCodeReward && !requiresFcfs && slotsMax > 0;
  const showRaffleWinners =
    !isCodeFcfs &&
    (isDrawCcRaffle || showWaitlistRaffleWinners || showWaitlistEmailWinners) &&
    slotsMax > 0;
  const raffleWinnersLabel =
    showWaitlistRaffleWinners || showWaitlistEmailWinners
      ? String(slotsMax)
      : winnersDrawn > 0
        ? t("earnCampaigns.slotsSelected", {
            used: String(winnersDrawn),
            max: String(slotsMax),
          })
        : String(slotsMax);
  const rafflePct =
    slotsMax > 0 ? Math.round((winnersDrawn / slotsMax) * 100) : 0;
  const poolLabel = formatPoolTotalLabel(summary?.poolTotalCc ?? null, quest.rewardPool);
  const poolDisplay =
    isCodeReward && /^\d+(\.\d+)?$/.test(poolLabel.trim())
      ? `${poolLabel.trim()} ${t("earnCampaigns.codeLabel")}`
      : poolLabel;
  const showPool = poolLabel !== "—" || (summary?.poolTotalCc ?? 0) > 0;
  const showCodes =
    summary?.codesRemaining != null &&
    !isCodeFcfs &&
    summary.requiresPaidInviteClaim;

  const slotsPct = slotsMax > 0 ? Math.round((slotsUsed / slotsMax) * 100) : 0;

  const ctaLabel = joinBlocked
    ? t("earnCampaigns.slotsEnded")
    : quest.status === "ENDED"
      ? t("quests.viewRecap")
      : completed
        ? t("quests.questComplete")
        : hasParticipated && slotsFull
          ? t("earnCampaigns.viewMyQuest")
          : t("quests.joinQuest");

  const statusLabel =
    slotsFull && quest.status === "ACTIVE"
      ? t("earnCampaigns.slotsEnded")
      : statusMeta.label;

  const bannerRewardText =
    quest.rewardCc > 0
      ? null
      : isCodeReward
        ? t("earnCampaigns.cardRewardPerUserCode")
        : quest.rewardPool;

  const inner = (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]",
        "transition-all duration-300 ease-out",
        canOpen &&
          !joinBlocked &&
          "hover:-translate-y-0.5 hover:border-[rgb(var(--canton-rgb)/0.35)] hover:shadow-[0_20px_50px_rgb(0_0_0/0.35),0_0_0_1px_rgb(var(--canton-rgb)/0.12)]",
        (quest.status === "ENDED" || joinBlocked) && "opacity-[0.92]",
      )}
    >
      {/* Banner */}
      <div className="relative h-[8rem] shrink-0 overflow-hidden sm:h-[9.5rem]">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-[1.03]"
          style={
            quest.bannerImageUrl
              ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
              : { background: quest.banner }
          }
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)] via-[var(--card)]/55 to-black/25" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.15),transparent_55%)]" />

        <div className="absolute left-4 top-4 flex flex-wrap gap-2">
          <span
            className={cn(
              "rounded-xl border px-3 py-1 text-xs font-bold uppercase tracking-wide backdrop-blur-md",
              theme.chip,
            )}
          >
            {kindLabel(uiKind, quest.rewardType, t)}
          </span>
        </div>

        <span
          className={cn(
            "absolute right-4 top-4 rounded-xl px-3 py-1 text-xs font-bold uppercase tracking-wide backdrop-blur-md",
            slotsFull && quest.status === "ACTIVE"
              ? "border border-white/5 bg-black/50 text-slate-400"
              : "border border-white/10 bg-black/45 text-white/95",
            !(slotsFull && quest.status === "ACTIVE") && statusMeta.className,
          )}
        >
          {statusLabel}
        </span>

        {/* Reward highlight on banner (Galxe-style) */}
        {quest.rewardCc > 0 || bannerRewardText ? (
          <div className="absolute bottom-4 right-4 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-3 py-2 backdrop-blur-md">
            <CampaignRewardIcon theme={theme} className={cn("shrink-0", theme.accent)} size={18} />
            <div className="min-w-0 text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/60">
                {t("earnCampaigns.rewardLabel")}
              </p>
              {quest.rewardCc > 0 ? (
                <p className={cn("text-xl font-bold leading-none tabular-nums", theme.accent)}>
                  {quest.rewardCc}
                  <span className="ml-1 text-sm font-semibold text-white/70">CC</span>
                </p>
              ) : (
                <p className={cn("truncate text-base font-bold leading-tight", theme.accent)}>
                  {bannerRewardText}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col px-6 pb-6 pt-4">
        <div className="flex gap-4">
          <div
            className={cn(
              "relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-[var(--muted)]",
            )}
          >
            {quest.logoUrl ? (
              <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-base font-bold text-canton">
                {quest.orgSlug.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-400">
              {quest.org}
            </p>
            <h3 className="mt-1 line-clamp-2 text-lg font-bold leading-snug text-slate-100 sm:text-xl">
              {quest.title}
            </h3>
          </div>
        </div>

        <p className="mt-3 line-clamp-2 text-sm font-medium leading-relaxed text-slate-400">
          {quest.description}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <ListChecks className="h-4 w-4 text-canton" />
            {quest.tasks.length} tasks
          </span>
          {quest.deadline ? (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              {quest.deadline}
            </span>
          ) : null}
        </div>

        {/* Metrics strip — no claim fee */}
        {(showFcfs || showRaffleWinners || showPool || showCodes) && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/5 bg-[var(--muted)]/20">
            <div className="grid grid-cols-2 divide-x divide-y divide-slate-800/80 sm:flex sm:divide-y-0">
              {showRaffleWinners ? (
                <Metric
                  label={t("earnCampaigns.cardRaffleWinners")}
                  value={raffleWinnersLabel}
                  icon={Users}
                  accent={theme.accent}
                />
              ) : null}
              {showFcfs ? (
                <Metric
                  label={t("earnCampaigns.cardFcfsSlots")}
                  value={formatFcfsSlotsFilled(
                    slotsLeft,
                    summary!.maxWinners,
                    t("earnCampaigns.slotsEnded"),
                  )}
                  icon={Zap}
                  accent={slotsFull ? undefined : "text-canton"}
                  muted={slotsFull}
                />
              ) : null}
              {showPool ? (
                <Metric
                  label={t("earnCampaigns.cardPoolTotal")}
                  value={poolDisplay}
                  icon={Users}
                  accent={theme.accent}
                />
              ) : null}
              {showCodes ? (
                <Metric
                  label={t("earnCampaigns.cardCodes")}
                  value={t("earnCampaigns.cardCodesRemaining", {
                    n: String(summary!.codesRemaining ?? 0),
                  })}
                  icon={Ticket}
                />
              ) : null}
            </div>
            {isDrawCcRaffle && showRaffleWinners && winnersDrawn > 0 ? (
              <div className="border-t border-slate-800/80 px-4 py-3">
                <div className="mb-1.5 flex justify-between text-xs font-medium tabular-nums text-slate-400">
                  <span>
                    {t("earnCampaigns.slotsSelected", {
                      used: String(winnersDrawn),
                      max: String(slotsMax),
                    })}
                  </span>
                  <span>{rafflePct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800/80">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)] transition-all duration-500"
                    style={{ width: `${Math.max(6, rafflePct)}%` }}
                  />
                </div>
              </div>
            ) : null}
            {showFcfs && !slotsFull ? (
              <div className="border-t border-slate-800/80 px-4 py-3">
                <div className="mb-1.5 flex justify-between text-xs font-medium tabular-nums text-slate-400">
                  <span>{t("earnCampaigns.slotsClaimed", { used: String(slotsUsed), max: String(slotsMax) })}</span>
                  <span>{slotsPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800/80">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      slotsLeft <= 1
                        ? "bg-gradient-to-r from-amber-500 to-orange-500"
                        : "bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)]",
                    )}
                    style={{ width: `${Math.max(6, slotsPct)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-auto pt-6">
          {joinBlocked ? (
            <span className={cn(buttonVariants({ variant: "muted", size: "block" }))}>
              {ctaLabel}
            </span>
          ) : canOpen ? (
            <span
              className={cn(
                buttonVariants({
                  variant:
                    quest.status === "ENDED"
                      ? "secondary"
                      : completed
                        ? "success"
                        : "primary",
                  size: "block",
                }),
              )}
            >
              {ctaLabel}
            </span>
          ) : (
            <span className={cn(buttonVariants({ variant: "dashed", size: "block" }))}>
              Opens soon
            </span>
          )}
        </div>
      </div>
    </article>
  );

  if (joinBlocked || !canOpen) {
    return inner;
  }

  return (
    <Link
      href={ROUTES.campaignQuest(quest.id, quest.title)}
      className="block h-full rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {inner}
    </Link>
  );
}
