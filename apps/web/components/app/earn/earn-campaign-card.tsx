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
  Tag,
  Ticket,
  Trophy,
  Users,
  Zap,
} from "lucide-react";

/** Map iconKind from quest-engine to a Lucide icon. */
const ICON_MAP: Record<RewardIconKind, typeof Coins> = {
  cc: Coins,
  ticket: Ticket,
  sparkles: Sparkles,
  trophy: Trophy,
};

/** Map metric iconKind (including zap/users/ticket) to Lucide icon. */
function metricIcon(kind: string): typeof Coins {
  switch (kind) {
    case "cc": return Coins;
    case "zap": return Zap;
    case "users": return Users;
    case "ticket": return Ticket;
    case "sparkles": return Sparkles;
    default: return Trophy;
  }
}

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
  if (diff <= 0) return <span className="text-red-400 font-bold text-[10px]">Ended</span>;
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

function Metric({
  label, value, icon: Icon, useCcLogo, accent, muted,
}: {
  label: string; value: string; icon: typeof Coins; useCcLogo?: boolean; accent?: string; muted?: boolean;
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
      <p className={cn("mt-1 truncate text-xs font-bold tabular-nums sm:text-sm md:text-base",
        muted ? "text-slate-400" : accent ?? "text-white")}>
        {value}
      </p>
    </div>
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
  const { config, rewardDisplay, slots, metrics } = meta;

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
  const bannerRewardText = quest.rewardCc > 0 ? null : isCodeReward ? t("earnCampaigns.cardRewardPerUserCode") : quest.rewardPool;

  // Use completed prop to override CTA if passed
  const ctaLabel = meta.joinBlocked
    ? t("earnCampaigns.slotsEnded")
    : quest.status === "ENDED" ? "View"
    : completed ? t("quests.questComplete")
    : meta.hasParticipated && slots.full ? t("earnCampaigns.viewMyQuest")
    : t("quests.joinQuest");

  const inner = (
    <article className={cn(
      "group relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50",
      "transition-all duration-300 ease-out",
      meta.canOpen && !meta.joinBlocked && "hover:-translate-y-1 hover:border-[rgb(var(--canton-rgb)/0.25)] hover:shadow-[0_24px_60px_rgb(0_0_0/0.5),0_0_0_1px_rgb(var(--canton-rgb)/0.15)]",
      (quest.status === "ENDED" || meta.joinBlocked) && "opacity-90",
    )}>
      {/* Banner */}
      <div className="relative h-32 shrink-0 overflow-hidden sm:h-36 md:h-40 lg:h-44">
        <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
          style={quest.bannerImageUrl ? { backgroundImage: `url("${quest.bannerImageUrl}")` } : { background: quest.banner }} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0c14] via-[#0a0c14]/60 to-black/30" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,rgb(var(--canton-rgb)/0.10),transparent_60%)]" />

        {/* Type badge */}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5 sm:left-4 sm:top-4 sm:gap-2">
          <span className={cn("rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur-xl sm:px-3 sm:py-1.5 sm:text-xs", config.chipClass)}>
            {config.shortLabel}
          </span>
        </div>

        {/* Status badge */}
        <span className={cn(
          "absolute right-3 top-3 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur-xl sm:right-4 sm:top-4 sm:px-3 sm:py-1.5 sm:text-xs",
          slots.full && quest.status === "ACTIVE"
            ? "border border-white/5 bg-black/60 text-slate-400"
            : "border border-white/10 bg-black/50 text-white",
          !(slots.full && quest.status === "ACTIVE") && statusMeta.className,
        )}>
          {statusLabel}
        </span>

        {/* Reward highlight */}
        {config.isDual ? (
          <div className="absolute bottom-3 right-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border border-white/[0.08] bg-black/70 px-3 py-2 backdrop-blur-xl sm:bottom-4 sm:right-4 sm:gap-3 sm:px-4 sm:py-2.5">
            <div className="flex items-center gap-1">
              <CcRewardLogo className="shrink-0 text-canton" size={14} />
              <span className="text-white/40">+</span>
              <Ticket className="h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden />
            </div>
            <div className="min-w-0 text-right">
              <p className="hidden text-[9px] font-bold uppercase tracking-wider text-white/60 sm:block sm:text-[10px]">Per Winner</p>
              <p className="text-sm font-bold leading-none tabular-nums text-canton sm:text-base">
                {quest.rewardCc > 0 ? <span>{quest.rewardCc} <span className="text-xs text-white/70">CC</span></span> : null}
                {quest.rewardCc > 0 ? <span className="mx-1 text-white/40">+</span> : null}
                <span className="text-violet-300">1 Code</span>
              </p>
            </div>
          </div>
        ) : quest.rewardCc > 0 || bannerRewardText ? (
          <div className="absolute bottom-3 right-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-xl border border-white/[0.08] bg-black/70 px-3 py-2 backdrop-blur-xl sm:bottom-4 sm:right-4 sm:gap-3 sm:px-4 sm:py-2.5">
            <CampaignRewardIcon iconKind={rewardDisplay.iconKind} isCcToken={config.isCcToken} className={cn("shrink-0", config.accentClass)} size={14} />
            <div className="min-w-0 text-right">
              <p className="hidden text-[9px] font-bold uppercase tracking-wider text-white/60 sm:block sm:text-[10px]">
                {t("earnCampaigns.rewardLabel")}
              </p>
              {quest.rewardCc > 0 ? (
                <p className={cn("text-base font-bold leading-none tabular-nums sm:text-xl md:text-2xl", config.accentClass)}>
                  {quest.rewardCc}
                  <span className="ml-1 text-xs font-semibold text-white/70 sm:text-sm">CC</span>
                </p>
              ) : (
                <p className={cn("truncate text-sm font-bold leading-tight sm:text-base", config.accentClass)}>
                  {bannerRewardText}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex w-full min-w-0 flex-1 flex-col justify-between px-4 pb-5 pt-4 sm:px-5 sm:pb-6 sm:pt-5 md:px-6 md:pb-7">
        <div className="flex w-full min-w-0 items-center gap-3 sm:gap-4">
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-800/80 ring-1 ring-white/10 sm:h-14 sm:w-14">
            {quest.logoUrl ? (
              <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs font-bold text-canton sm:text-base">
                {quest.orgSlug.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold text-slate-500 sm:text-xs">{quest.org}</p>
            <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white sm:mt-0.5 sm:text-base md:text-lg">
              {quest.title}
            </h3>
          </div>
        </div>

        <p className="mt-3 hidden line-clamp-2 text-sm font-medium leading-relaxed text-slate-400 sm:block">
          {quest.description}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] font-semibold text-slate-500 sm:mt-4 sm:gap-x-4 sm:text-xs">
          <span className="inline-flex items-center gap-1 sm:gap-1.5">
            <ListChecks className="h-3 w-3 text-canton sm:h-4 sm:w-4" />
            {quest.tasks.length} tasks
          </span>
          {quest.endsAt ? <CountdownTimer endsAt={quest.endsAt} /> : quest.deadline ? (
            <span className="inline-flex items-center gap-1 sm:gap-1.5">
              <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="truncate">{quest.deadline}</span>
            </span>
          ) : null}
          {summary?.slotsTaken != null && summary.slotsTaken > 0 && (
            <span className="inline-flex items-center gap-1 sm:gap-1.5">
              <Users className="h-3 w-3 sm:h-4 sm:w-4" />
              {summary.slotsTaken}
            </span>
          )}
        </div>

        {quest.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {quest.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="inline-flex items-center gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-slate-500">
                <Tag className="h-2.5 w-2.5 shrink-0 opacity-50" aria-hidden />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Metrics strips — driven by quest-engine */}
        {metrics.length > 0 && (
          <div className="mt-4 w-full min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] sm:mt-5">
            <div className="grid w-full min-w-0 grid-cols-2 divide-x divide-white/[0.04]">
              {metrics.map((m) => (
                <Metric
                  key={m.key}
                  label={m.label}
                  value={m.key === "pool" ? poolDisplay : m.value}
                  icon={metricIcon(m.iconKind)}
                  useCcLogo={m.useCcLogo}
                  accent={m.accent}
                  muted={m.muted}
                />
              ))}
            </div>
            {meta.showProgress && meta.progressBar ? (
              <div className="border-t border-white/[0.04] px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="mb-1.5 flex justify-between text-[9px] font-semibold tabular-nums text-slate-500 sm:text-xs">
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
        )}

        {/* CTA Button */}
        <div className="mt-4">
          {meta.joinBlocked ? (
            <span className={cn(buttonVariants({ variant: "muted", size: "block" }),
              "flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold")}>{ctaLabel}</span>
          ) : meta.canOpen ? (
            <span className={cn(buttonVariants({
              variant: quest.status === "ENDED" ? "secondary" : completed ? "success" : "primary", size: "block",
            }), "flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold")}>{ctaLabel}</span>
          ) : (
            <span className={cn(buttonVariants({ variant: "dashed", size: "block" }),
              "flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold")}>Opens soon</span>
          )}
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
