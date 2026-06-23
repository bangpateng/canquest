"use client";

import Link from "next/link";
import { getQuestMeta, type RewardIconKind } from "@/lib/quest/quest-engine";
import { formatPoolTotalLabel } from "@/lib/canton/campaign-reward";
import { ROUTES } from "@/lib/routing/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { QUEST_STATUS_BADGE, type Quest, type UserProgress } from "@/lib/quest/quest-types";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { useEffect, useState } from "react";
import {
  Calendar,
  Clock,
  Coins,
  ListChecks,
  Sparkles,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";

/** Map iconKind from quest-engine to a Lucide icon. */
const ICON_MAP: Record<RewardIconKind, typeof Coins> = {
  cc: Coins,
  ticket: Ticket,
  sparkles: Sparkles,
  trophy: Trophy,
};

function CampaignRewardIcon({
  iconKind,
  isCcToken,
  className,
  size = 16,
}: {
  iconKind: RewardIconKind;
  isCcToken: boolean;
  className?: string;
  size?: number;
}) {
  if (isCcToken) {
    return <CcRewardLogo className={className} size={size} />;
  }
  const Icon = ICON_MAP[iconKind];
  return <Icon className={className} aria-hidden />;
}

function CountdownTimer({ endsAt }: { endsAt: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  const diff = end - now;
  if (diff <= 0) return <span className="font-bold text-red-400 text-[10px]">Ended</span>;
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 sm:text-xs">
      <Clock className="h-3 w-3" aria-hidden />
      {parts.join(" ")}
    </span>
  );
}

/** Compact dot indicator for status — merges status + type into one visual. */
function StatusDot({ quest, statusMeta }: { quest: Quest; statusMeta: { className: string; label: string } }) {
  const color =
    quest.status === "ACTIVE" ? "bg-emerald-400"
      : quest.status === "COMING_SOON" ? "bg-cyan-400"
        : "bg-slate-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">
      <span className={cn("relative flex h-2 w-2", "shrink-0")}>
        {quest.status === "ACTIVE" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
      </span>
      {statusMeta.label}
    </span>
  );
}

export function EarnCampaignCard({
  quest, completed = false, userProgress = null,
}: {
  quest: Quest; completed?: boolean; userProgress?: UserProgress | null;
}) {
  const t = usePlatformT();
  const summary = quest.campaignSummary;

  // ── Derive all UI state from quest-engine ─────────────────────
  const meta = getQuestMeta(quest, userProgress);
  const { config, rewardDisplay, slots } = meta;

  const isCodeReward =
    config.code === "INVITE_CODE_FCFS" ||
    config.code === "INVITE_CODE_RANDOM";

  // Pool display — enrich code-only pools with label
  const poolLabel = formatPoolTotalLabel(summary?.poolTotalCc ?? null, quest.rewardPool);
  const poolDisplay = isCodeReward && /^\d+(\.\d+)?$/.test(poolLabel.trim())
    ? `${poolLabel.trim()} ${t("earnCampaigns.codeLabel")}`
    : poolLabel;

  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const statusLabel = slots.full && quest.status === "ACTIVE" ? t("earnCampaigns.slotsEnded") : statusMeta.label;

  // Reward pill text
  let rewardPillText: string;
  if (config.isDual) {
    rewardPillText = quest.rewardCc > 0 ? `${quest.rewardCc} CC + 1 Code` : "CC + 1 Code";
  } else if (config.isCcToken && quest.rewardCc > 0) {
    rewardPillText = `${quest.rewardCc} CC · winner`;
  } else if (isCodeReward) {
    rewardPillText = t("earnCampaigns.cardRewardPerUserCode");
  } else if (config.code === "WAITLIST_EMAIL") {
    rewardPillText = "Waitlist spot";
  } else {
    rewardPillText = quest.rewardPool ?? "—";
  }

  // CTA
  const ctaLabel = meta.joinBlocked
    ? t("earnCampaigns.slotsEnded")
    : quest.status === "ENDED" ? "View"
    : completed ? t("quests.questComplete")
    : meta.hasParticipated && slots.full ? t("earnCampaigns.viewMyQuest")
    : t("quests.joinQuest");

  const ctaVariant: "primary" | "secondary" | "success" | "muted" | "dashed" =
    meta.joinBlocked ? "muted"
    : quest.status === "ENDED" ? "secondary"
    : completed ? "success"
    : meta.canOpen ? "primary"
    : "dashed";

  // Urgency text
  const urgencyText = quest.endsAt
    ? (slots.full ? null : <CountdownTimer endsAt={quest.endsAt} />)
    : quest.deadline ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Calendar className="h-3 w-3" />
        <span className="truncate max-w-[120px]">{quest.deadline}</span>
      </span>
    ) : null;

  const inner = (
    <article className={cn(
      "group relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50",
      "transition-all duration-300 ease-out",
      meta.canOpen && !meta.joinBlocked && "hover:-translate-y-1 hover:border-[rgb(var(--canton-rgb)/0.25)] hover:shadow-[0_24px_60px_rgb(0_0_0/0.5),0_0_0_1px_rgb(var(--canton-rgb)/0.15)]",
      (quest.status === "ENDED" || meta.joinBlocked) && "opacity-90",
    )}>

      {/* ── Banner accent strip ─────────────────────────────────── */}
      {quest.bannerImageUrl ? (
        <div
          className="relative h-20 w-full shrink-0 overflow-hidden"
          style={{ maxHeight: "80px" }}
        >
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
            style={{ backgroundImage: `url("${quest.bannerImageUrl}")` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0c14] via-[#0a0c14]/40 to-transparent" />
          {/* Status badge floats over banner */}
          <div className="absolute right-2.5 top-2.5">
            <span className={cn(
              "rounded-lg px-2 py-1 text-[9px] font-bold uppercase tracking-wide backdrop-blur-xl sm:px-2.5 sm:text-[10px]",
              slots.full && quest.status === "ACTIVE"
                ? "border border-white/5 bg-black/60 text-slate-400"
                : "border border-white/10 bg-black/50 text-white",
              !(slots.full && quest.status === "ACTIVE") && statusMeta.className,
            )}>
              {statusLabel}
            </span>
          </div>
        </div>
      ) : null}

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex w-full min-w-0 flex-1 flex-col justify-between px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">

        {/* Header: logo + org/title */}
        <div className="flex w-full min-w-0 items-start gap-3 sm:gap-3.5">
          {/* Logo */}
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-800/80 ring-1 ring-white/10 sm:h-12 sm:w-12">
            {quest.logoUrl ? (
              <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs font-bold text-canton sm:text-sm">
                {quest.orgSlug.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          {/* Org + Title + status (if no banner) */}
          <div className="min-w-0 flex-1">
            {!quest.bannerImageUrl && (
              <div className="mb-1 flex items-center justify-between gap-2">
                <StatusDot quest={quest} statusMeta={statusMeta} />
              </div>
            )}
            <p className="truncate text-[10px] font-semibold text-slate-500 sm:text-xs">{quest.org}</p>
            <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white sm:mt-0.5 sm:text-base">
              {quest.title}
            </h3>
          </div>

          {/* Type chip (right) — only when banner present (status already on banner) */}
          {quest.bannerImageUrl ? (
            <span className={cn(
              "mt-1 shrink-0 rounded-lg border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide backdrop-blur-xl sm:text-[10px]",
              config.chipClass,
            )}>
              {config.shortLabel}
            </span>
          ) : null}
        </div>

        {/* Description */}
        <p className="mt-2.5 line-clamp-2 text-xs font-medium leading-relaxed text-slate-400 sm:mt-3 sm:text-sm">
          {quest.description}
        </p>

        {/* ── REWARD HERO BLOCK (paling menonjol) ───────────────── */}
        <div className={cn(
          "mt-3 overflow-hidden rounded-xl border bg-white/[0.02] sm:mt-4",
          config.isCcToken
            ? "border-[rgb(var(--canton-rgb)/0.18)]"
            : "border-white/[0.08]",
        )}>
          <div className={cn(
            "pointer-events-none absolute inset-0",
            config.isCcToken && "bg-[radial-gradient(ellipse_80%_100%_at_50%_0%,rgb(var(--canton-rgb)/0.10),transparent_70%)]",
          )} />
          <div className="relative flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <span className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9",
                config.isCcToken
                  ? "bg-[rgb(var(--canton-rgb)/0.12)]"
                  : config.code === "WAITLIST_EMAIL" ? "bg-cyan-500/12" : "bg-violet-500/12",
              )}>
                <CampaignRewardIcon
                  iconKind={rewardDisplay.iconKind}
                  isCcToken={config.isCcToken}
                  className={cn("h-4 w-4 sm:h-[18px] sm:w-[18px]", config.accentClass)}
                  size={18}
                />
              </span>
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 sm:text-[10px]">
                  {config.isDual ? "Reward · winner" : config.shortLabel}
                </p>
                <p className={cn(
                  "truncate text-sm font-bold tabular-nums sm:text-base",
                  config.accentClass,
                )}>
                  {rewardPillText}
                </p>
              </div>
            </div>
            {/* Right: pool value + USD */}
            {summary?.poolTotalCc != null && summary.poolTotalCc > 0 ? (
              <div className="shrink-0 text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 sm:text-[10px]">Pool</p>
                <p className="truncate text-xs font-bold tabular-nums text-white sm:text-sm">{poolDisplay}</p>
              </div>
            ) : null}
          </div>

          {/* Progress bar (FCFS) */}
          {meta.showProgress && meta.progressBar ? (
            <div className="relative border-t border-white/[0.04] px-3 py-2 sm:px-4">
              <div className="mb-1 flex justify-between text-[9px] font-semibold tabular-nums text-slate-500 sm:text-[10px]">
                <span>{t("earnCampaigns.slotsClaimed", { used: String(meta.progressBar.used), max: String(meta.progressBar.max) })}</span>
                <span>{meta.progressBar.pct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={cn("h-full rounded-full transition-all duration-500",
                  meta.progressBar.warn ? "bg-gradient-to-r from-amber-500 to-orange-500" : "bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)]")}
                  style={{ width: `${Math.max(6, meta.progressBar.pct)}%` }} />
              </div>
            </div>
          ) : null}
        </div>

        {/* Meta row — single line: tasks + deadline */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-500 sm:mt-3.5 sm:text-xs">
          <span className="inline-flex items-center gap-1 sm:gap-1.5">
            <ListChecks className="h-3 w-3 text-canton sm:h-3.5 sm:w-3.5" />
            {quest.tasks.length} tasks
          </span>
          {urgencyText}
          {meta.showProgress && meta.progressBar ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              {meta.progressBar.used}/{meta.progressBar.max}
            </span>
          ) : slots.max > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              {slots.max} {config.isFcfs ? "slots" : "winners"}
            </span>
          ) : null}
        </div>

        {/* CTA */}
        <div className="mt-3.5 sm:mt-4">
          <span className={cn(buttonVariants({ variant: ctaVariant, size: "block" }),
            "flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold sm:h-12")}>
            {ctaLabel}
          </span>
        </div>
      </div>
    </article>
  );

  if (meta.joinBlocked || !meta.canOpen) return inner;

  return (
    <Link href={ROUTES.campaignQuest(quest.id, quest.title)}
      className="block h-full w-full min-w-0 max-w-full overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]">
      {inner}
    </Link>
  );
}
