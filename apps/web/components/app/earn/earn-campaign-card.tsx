"use client";

import Link from "next/link";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { formatRewardAmount } from "@/lib/canton/campaign-reward";
import { questRewardToken } from "@/lib/quest/quest-types";
import { ROUTES } from "@/lib/routing/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { QUEST_STATUS_BADGE, type Quest, type UserProgress } from "@/lib/quest/quest-types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Calendar, Clock, ListChecks, Users } from "lucide-react";

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

/** Status badge — floats top-left over the banner. */
function StatusBadge({
  quest,
  statusLabel,
}: {
  quest: Quest;
  statusLabel: string;
}) {
  const isActive = quest.status === "ACTIVE";
  const isComing = quest.status === "COMING_SOON";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider backdrop-blur-md sm:text-[10px]",
        isActive && "border border-emerald-500/25 bg-emerald-500/15 text-emerald-300",
        isComing && "border border-cyan-500/25 bg-cyan-500/15 text-cyan-300",
        !isActive && !isComing && "border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {isActive && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
        )}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            isActive ? "bg-emerald-400" : isComing ? "bg-cyan-400" : "bg-[var(--muted-foreground)]",
          )}
        />
      </span>
      {statusLabel}
    </span>
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

  // ── Derive all UI state from quest-engine ─────────────────────
  const meta = getQuestMeta(quest, userProgress);
  const { config, slots } = meta;

  const isCodeReward =
    config.code === "INVITE_CODE_FCFS" ||
    config.code === "INVITE_CODE_RANDOM";
  const token = questRewardToken(quest);

  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const statusLabel =
    slots.full && quest.status === "ACTIVE"
      ? t("earnCampaigns.slotsEnded")
      : statusMeta.label;

  // Reward pill text
  let rewardPillText: string;
  if (config.isDual) {
    rewardPillText =
      quest.rewardCc > 0
        ? `${formatRewardAmount(quest.rewardCc, token)} + 1 Code`
        : `${token} + 1 Code`;
  } else if (config.isCcToken && quest.rewardCc > 0) {
    rewardPillText = `${formatRewardAmount(quest.rewardCc, token)} · winner`;
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
    : quest.status === "ENDED"
      ? "View"
      : completed
        ? t("quests.questComplete")
        : meta.hasParticipated && slots.full
          ? t("earnCampaigns.viewMyQuest")
          : t("quests.joinQuest");

  const ctaVariant: "primary" | "secondary" | "success" | "muted" | "dashed" =
    meta.joinBlocked
      ? "muted"
      : quest.status === "ENDED"
        ? "secondary"
        : completed
          ? "success"
          : meta.canOpen
            ? "primary"
            : "dashed";

  // Urgency text
  const urgencyText = quest.endsAt
    ? slots.full
      ? null
      : <CountdownTimer endsAt={quest.endsAt} />
    : quest.deadline
      ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--muted-foreground)]">
          <Calendar className="h-3 w-3" />
          <span className="truncate max-w-[120px]">{quest.deadline}</span>
        </span>
      )
      : null;

  const inner = (
    <Card
      interactive
      className={cn(
        "group relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden",
        "transition-all duration-300 ease-out",
        meta.canOpen &&
          !meta.joinBlocked &&
          "hover:-translate-y-1 hover:border-[rgb(var(--canton-rgb)/0.25)] hover:shadow-[0_24px_60px_rgb(0_0_0/0.5),0_0_0_1px_rgb(var(--canton-rgb)/0.15)]",
        (quest.status === "ENDED" || meta.joinBlocked) && "opacity-90",
      )}
    >
      {/* ── Banner ─────────────────────────────────────────────── */}
      <div className="relative h-28 w-full shrink-0 overflow-hidden sm:h-32">
        {quest.bannerImageUrl ? (
          <div
            className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
            style={{ backgroundImage: `url("${quest.bannerImageUrl}")` }}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary)]/15 to-[var(--muted)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--card)] via-transparent to-transparent" />
        {/* Status badge — top-left */}
        <div className="absolute left-2.5 top-2.5">
          <StatusBadge quest={quest} statusLabel={statusLabel} />
        </div>
        {/* Type short-label pill — top-right */}
        <span className="absolute right-2.5 top-2.5 inline-flex items-center rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/90 ring-1 ring-white/10 backdrop-blur-md">
          {config.shortLabel}
        </span>
      </div>

      {/* ── Body (overlaps banner so the logo punches through) ── */}
      <div className="relative flex flex-1 flex-col p-4 sm:p-5" style={{ marginTop: "-2rem" }}>
        {/* Logo + reward row */}
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--card)] shadow-lg ring-4 ring-[var(--card)]">
            {quest.logoUrl ? (
              <img src={quest.logoUrl} alt="" className="h-full w-full rounded-xl object-cover" />
            ) : (
              <span className={cn("text-sm font-bold", config.accentClass)}>
                {quest.orgSlug.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {config.isDual ? "Reward · winner" : "Reward"}
            </p>
            <p className={cn("truncate text-sm font-bold tabular-nums", config.accentClass)}>
              {rewardPillText}
            </p>
          </div>
        </div>

        <p className="text-[10px] font-semibold text-[var(--muted-foreground)]">{quest.org}</p>
        <h3 className="mt-0.5 line-clamp-2 text-base font-bold leading-tight text-[var(--foreground)]">
          {quest.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-relaxed text-[var(--muted-foreground)]">
          {quest.description}
        </p>

        {/* FCFS progress */}
        {meta.showProgress && meta.progressBar ? (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[10px] font-semibold tabular-nums text-[var(--muted-foreground)]">
              <span>
                {meta.progressBar.used} / {meta.progressBar.max}
              </span>
              <span>{meta.progressBar.pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  meta.progressBar.warn
                    ? "bg-gradient-to-r from-amber-500 to-orange-500"
                    : "bg-gradient-brand",
                )}
                style={{ width: `${Math.max(6, meta.progressBar.pct)}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Footer meta */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3 text-[10px] font-semibold text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1">
            <ListChecks className="h-3 w-3 text-canton" />
            {quest.tasks.length}
          </span>
          {slots.max > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {meta.showProgress && meta.progressBar
                ? `${meta.progressBar.used}/${meta.progressBar.max}`
                : `${slots.max} ${config.isFcfs ? "slots" : "winners"}`}
            </span>
          ) : (
            <span aria-hidden />
          )}
          {urgencyText ?? (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {quest.deadline ?? "—"}
            </span>
          )}
        </div>

        {/* CTA */}
        <div className="mt-3">
          <span
            className={cn(
              buttonVariants({ variant: ctaVariant, size: "block" }),
              "flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold",
            )}
          >
            {ctaLabel}
          </span>
        </div>
      </div>
    </Card>
  );

  if (meta.joinBlocked || !meta.canOpen) return inner;

  return (
    <Link
      href={ROUTES.campaignQuest(quest.id, quest.title)}
      className="block h-full w-full min-w-0 max-w-full overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
    >
      {inner}
    </Link>
  );
}
