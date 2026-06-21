"use client";

import Link from "next/link";
import { getQuestMeta, type RewardIconKind } from "@/lib/quest/quest-engine";
import { formatPoolTotalLabel } from "@/lib/canton/campaign-reward";
import { ROUTES } from "@/lib/routing/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { QUEST_STATUS_BADGE, type Quest, type UserProgress } from "@/lib/quest/quest-types";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { CcUsdValue } from "@/components/app/earn/cc-usd-value";
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

      {/* ── Banner accent strip (only if bannerImageUrl exists) ─── */}
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
        </div>
      ) : null}

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex w-full min-w-0 flex-1 flex-col justify-between px-4 pb-5 pt-4 sm:px-5 sm:pb-6 sm:pt-5 md:px-6 md:pb-7">

        {/* Header: logo + org/title left, badges right */}
        <div className="flex w-full min-w-0 items-start gap-3 sm:gap-4">
          {/* Logo */}
          <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-800/80 ring-1 ring-white/10 sm:h-14 sm:w-14">
            {quest.logoUrl ? (
              <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-xs font-bold text-canton sm:text-base">
                {quest.orgSlug.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>

          {/* Org + Title */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold text-slate-500 sm:text-xs">{quest.org}</p>
            <h3 className="line-clamp-2 text-sm font-bold leading-tight text-white sm:mt-0.5 sm:text-base md:text-lg">
              {quest.title}
            </h3>
          </div>

          {/* Status + Type badges stacked */}
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className={cn(
              "rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur-xl sm:px-3 sm:py-1.5 sm:text-xs",
              slots.full && quest.status === "ACTIVE"
                ? "border border-white/5 bg-black/60 text-slate-400"
                : "border border-white/10 bg-black/50 text-white",
              !(slots.full && quest.status === "ACTIVE") && statusMeta.className,
            )}>
              {statusLabel}
            </span>
            <span className={cn(
              "rounded-lg border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur-xl sm:px-3 sm:py-1.5 sm:text-xs",
              config.chipClass,
            )}>
              {config.shortLabel}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="mt-3 line-clamp-2 text-sm font-medium leading-relaxed text-slate-400">
          {quest.description}
        </p>

        {/* Meta row: tasks + timer left, reward pill right */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 sm:mt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
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
          </div>

          {/* Reward pill */}
          <div className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1 text-[10px] font-bold backdrop-blur-xl sm:text-xs",
            config.accentClass,
          )}>
            <CampaignRewardIcon
              iconKind={rewardDisplay.iconKind}
              isCcToken={config.isCcToken}
              className={cn("shrink-0 h-3 w-3", config.accentClass)}
              size={12}
            />
            <span className="truncate">{rewardPillText}</span>
          </div>
        </div>

        {/* Tags */}
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

        {/* Metrics strip — driven by quest-engine */}
        {metrics.length > 0 && (
          <div className="mt-4 w-full min-w-0 overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] sm:mt-5">
            <div className="grid w-full min-w-0 grid-cols-2 divide-x divide-white/[0.04]">
              {metrics.map((m) => {
                if (m.key === "pool") {
                  const Icon = metricIcon(m.iconKind);
                  return (
                    <div key="pool" className="min-w-0 flex-1 overflow-hidden px-2 py-2 first:pl-0 last:pr-0 sm:px-3 sm:py-3 md:px-4">
                      <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400 sm:gap-1.5 sm:text-[10px]">
                        {m.useCcLogo ? (
                          <CcRewardLogo className="shrink-0 opacity-90" size={10} />
                        ) : (
                          <Icon className={cn("h-3 w-3 shrink-0 opacity-70", m.accent)} aria-hidden />
                        )}
                        <span className="truncate">{m.label}</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-bold tabular-nums sm:text-sm md:text-base text-white">
                        {poolDisplay}
                      </p>
                      {summary?.poolTotalCc != null && summary.poolTotalCc > 0 ? (
                        <CcUsdValue cc={summary.poolTotalCc} />
                      ) : null}
                    </div>
                  );
                }
                return (
                  <Metric
                    key={m.key}
                    label={m.label}
                    value={m.value}
                    icon={metricIcon(m.iconKind)}
                    useCcLogo={m.useCcLogo}
                    accent={m.accent}
                    muted={m.muted}
                  />
                );
              })}
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
