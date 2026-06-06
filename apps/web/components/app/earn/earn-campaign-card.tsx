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
  // CC + Code Raffle: special dual theme (CC + Ticket)
  if (rewardType === "CC_AND_CODE_RAFFLE") {
    return {
      icon: Ticket,
      isCcToken: true,
      isDualReward: true,
      accent: "text-canton",
      chip: "bg-gradient-to-r from-canton-soft to-violet-500/15 text-canton border-canton-muted",
    };
  }
  if (
    rewardType === "CC_ONLY" ||
    rewardType === "CC_MANUAL" ||
    rewardType === "CC_AND_INVITE" ||
    pool.includes("cc")
  ) {
    return {
      icon: Coins,
      isCcToken: true,
      isDualReward: false,
      accent: "text-canton",
      chip: "bg-canton-soft text-canton border-canton-muted",
    };
  }
  if (rewardType?.includes("INVITE") || pool.includes("invite") || pool.includes("fcfs")) {
    return {
      icon: Ticket,
      isCcToken: false,
      isDualReward: false,
      accent: "text-violet-300",
      chip: "bg-violet-500/15 text-violet-200 border-violet-500/25",
    };
  }
  if (rewardType === "WAITLIST_EMAIL" || pool.includes("waitlist")) {
    return {
      icon: Sparkles,
      isCcToken: false,
      isDualReward: false,
      accent: "text-cyan-300",
      chip: "bg-cyan-500/12 text-cyan-200 border-cyan-500/25",
    };
  }
  return {
    icon: Trophy,
    isCcToken: false,
    isDualReward: false,
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
    case "cc_and_code_raffle":
      return "CC + Code Raffle";
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
    <div className="min-w-0 flex-1 overflow-hidden px-2 py-2 first:pl-0 last:pr-0 sm:px-3 sm:py-3 md:px-4">
      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400 sm:gap-1.5 sm:text-[10px]">
        {useCcLogo ? (
          <CcRewardLogo className="shrink-0 opacity-90" size={10} />
        ) : (
          <Icon className={cn("h-3 w-3 shrink-0 opacity-70", accent)} aria-hidden />
        )}
        <span className="truncate">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 truncate text-xs font-bold tabular-nums sm:text-sm md:text-base",
          muted ? "text-slate-400" : accent ?? "text-white",
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
  const isCcAndCodeRaffle = quest.rewardType === "CC_AND_CODE_RAFFLE";
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
      ? "View"
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
        "group relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-white/[0.05] bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40",
        "transition-all duration-300 ease-out",
        canOpen &&
          !joinBlocked &&
          "hover:-translate-y-1 hover:border-[rgb(var(--canton-rgb)/0.25)] hover:shadow-[0_24px_60px_rgb(0_0_0/0.4),0_0_0_1px_rgb(var(--canton-rgb)/0.15)]",
        (quest.status === "ENDED" || joinBlocked) && "opacity-90",
      )}
    >
      {/* Banner */}
      <div className="relative h-32 shrink-0 overflow-hidden sm:h-36 md:h-40 lg:h-44">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
          style={
            quest.bannerImageUrl
              ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
              : { background: quest.banner }
          }
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-black/30" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.12),transparent_60%)]" />

        {/* Type & Status badges */}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5 sm:left-4 sm:top-4 sm:gap-2">
          <span
            className={cn(
              "rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur-xl sm:px-3 sm:py-1.5 sm:text-xs",
              theme.chip,
            )}
          >
            {kindLabel(uiKind, quest.rewardType, t)}
          </span>
        </div>

        <span
          className={cn(
            "absolute right-3 top-3 rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur-xl sm:right-4 sm:top-4 sm:px-3 sm:py-1.5 sm:text-xs",
            slotsFull && quest.status === "ACTIVE"
              ? "border border-white/5 bg-black/60 text-slate-400"
              : "border border-white/10 bg-black/50 text-white",
            !(slotsFull && quest.status === "ACTIVE") && statusMeta.className,
          )}
        >
          {statusLabel}
        </span>

        {/* Reward highlight on banner — CC+Code Raffle: dual icons */}
        {isCcAndCodeRaffle ? (
          <div className="absolute bottom-3 right-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-xl sm:bottom-4 sm:right-4 sm:gap-3 sm:px-4 sm:py-2.5">
            <div className="flex items-center gap-1">
              <CcRewardLogo className="shrink-0 text-canton" size={14} />
              <span className="text-white/40">+</span>
              <Ticket className="h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden />
            </div>
            <div className="min-w-0 text-right">
              <p className="hidden text-[9px] font-bold uppercase tracking-wider text-white/60 sm:block sm:text-[10px]">
                Per Winner
              </p>
              <p className="text-sm font-bold leading-none tabular-nums text-canton sm:text-base">
                {quest.rewardCc > 0 ? (
                  <span>{quest.rewardCc} <span className="text-xs text-white/70">CC</span></span>
                ) : null}
                {quest.rewardCc > 0 ? <span className="mx-1 text-white/40">+</span> : null}
                <span className="text-violet-300">1 Code</span>
              </p>
            </div>
          </div>
        ) : quest.rewardCc > 0 || bannerRewardText ? (
          <div className="absolute bottom-3 right-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-xl sm:bottom-4 sm:right-4 sm:gap-3 sm:px-4 sm:py-2.5">
            <CampaignRewardIcon theme={theme} className={cn("shrink-0", theme.accent)} size={14} />
            <div className="min-w-0 text-right">
              <p className="hidden text-[9px] font-bold uppercase tracking-wider text-white/60 sm:block sm:text-[10px]">
                {t("earnCampaigns.rewardLabel")}
              </p>
              {quest.rewardCc > 0 ? (
                <p className={cn("text-base font-bold leading-none tabular-nums sm:text-xl md:text-2xl", theme.accent)}>
                  {quest.rewardCc}
                  <span className="ml-1 text-xs font-semibold text-white/70 sm:text-sm">CC</span>
                </p>
              ) : (
                <p className={cn("truncate text-sm font-bold leading-tight sm:text-base", theme.accent)}>
                  {bannerRewardText}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Body — flex-col justify-between so CTA is always pinned to bottom */}
      <div className="flex w-full min-w-0 flex-1 flex-col justify-between px-4 pb-5 pt-4 sm:px-5 sm:pb-6 sm:pt-5 md:px-6 md:pb-7">
        <div className="flex w-full min-w-0 items-center gap-3 sm:gap-4">
          <div
            className={cn(
              "relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-800/80 sm:h-14 sm:w-14 sm:rounded-xl",
            )}
          >
            {quest.logoUrl ? (
              <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs font-bold text-canton sm:text-base">
                {quest.orgSlug.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold text-slate-500 sm:text-xs">
              {quest.org}
            </p>
            <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white sm:mt-0.5 sm:text-base md:text-lg">
              {quest.title}
            </h3>
          </div>
        </div>

        <p className="mt-3 hidden line-clamp-2 text-sm font-medium leading-relaxed text-slate-400 sm:block">
          {quest.description}
        </p>

        <div className="mt-3 flex items-center gap-3 text-[10px] font-semibold text-slate-500 sm:mt-4 sm:gap-4 sm:text-xs">
          <span className="inline-flex items-center gap-1 sm:gap-1.5">
            <ListChecks className="h-3 w-3 text-canton sm:h-4 sm:w-4" />
            {quest.tasks.length} tasks
          </span>
          {quest.deadline ? (
            <span className="inline-flex items-center gap-1 sm:gap-1.5">
              <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="truncate">{quest.deadline}</span>
            </span>
          ) : null}
        </div>

        {/* CC + Code Raffle: special metrics strip */}
        {isCcAndCodeRaffle && (
          <div className="mt-4 w-full min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] sm:mt-5">
            <div className="grid w-full min-w-0 grid-cols-3 divide-x divide-white/[0.04]">
              <Metric
                label="CC / Winner"
                value={quest.rewardCc > 0 ? `${quest.rewardCc} CC` : "—"}
                icon={Coins}
                useCcLogo
                accent="text-canton"
              />
              <Metric
                label="Code / Winner"
                value="1 Code"
                icon={Ticket}
                accent="text-violet-300"
              />
              {slotsMax > 0 ? (
                <Metric
                  label="Max Winners"
                  value={String(slotsMax)}
                  icon={Users}
                  accent="text-canton"
                />
              ) : (
                <Metric
                  label="Claim Fee"
                  value="5 CC"
                  icon={Zap}
                  accent="text-amber-300"
                />
              )}
            </div>
            {slotsMax > 0 && (
              <div className="border-t border-white/[0.04] px-3 py-2 sm:px-4">
                <p className="text-[9px] font-semibold text-slate-500 sm:text-[10px]">
                  Complete all social tasks → Submit → Wait for raffle draw → Claim reward
                </p>
              </div>
            )}
          </div>
        )}

        {/* Metrics strip */}
        {!isCcAndCodeRaffle && (showFcfs || showRaffleWinners || showPool || showCodes) && (
          <div className="mt-4 w-full min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] sm:mt-5">
            <div className="grid w-full min-w-0 grid-cols-2 divide-x divide-white/[0.04]">
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
              <div className="border-t border-white/[0.04] px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="mb-1.5 flex justify-between text-[9px] font-semibold tabular-nums text-slate-500 sm:text-xs">
                  <span>
                    {t("earnCampaigns.slotsSelected", {
                      used: String(winnersDrawn),
                      max: String(slotsMax),
                    })}
                  </span>
                  <span>{rafflePct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)] transition-all duration-500"
                    style={{ width: `${Math.max(6, rafflePct)}%` }}
                  />
                </div>
              </div>
            ) : null}
            {showFcfs && !slotsFull ? (
              <div className="border-t border-white/[0.04] px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="mb-1.5 flex justify-between text-[9px] font-semibold tabular-nums text-slate-500 sm:text-xs">
                  <span>{t("earnCampaigns.slotsClaimed", { used: String(slotsUsed), max: String(slotsMax) })}</span>
                  <span>{slotsPct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
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

        {/* CTA Button — fixed h-12 w-full on ALL states for perfect symmetry across tabs */}
        <div className="mt-4">
          {joinBlocked ? (
            <span
              className={cn(
                buttonVariants({ variant: "muted", size: "block" }),
                "flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold",
              )}
            >
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
                "flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold",
              )}
            >
              {ctaLabel}
            </span>
          ) : (
            <span
              className={cn(
                buttonVariants({ variant: "dashed", size: "block" }),
                "flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold",
              )}
            >
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
      className="block h-full w-full min-w-0 max-w-full overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
    >
      {inner}
    </Link>
  );
}
