"use client";

import Link from "next/link";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { formatRewardAmount } from "@/lib/canton/campaign-reward";
import { questRewardToken } from "@/lib/quest/quest-types";
import { TokenUsdValue } from "@/components/app/earn/cc-usd-value";
import { ROUTES } from "@/lib/routing/app-routes";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { QUEST_STATUS_BADGE, type Quest, type UserProgress } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import { useEffect, useState } from "react";
import { Calendar, ListChecks } from "lucide-react";

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
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300">
      {parts.join(" ")}
    </span>
  );
}

/** "Aug 25" — short end date for raffle / meta rows. */
function shortEndDate(quest: Quest): string {
  if (quest.endsAt) {
    return new Date(quest.endsAt).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  }
  return quest.deadline ?? "—";
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

  const isEnded = quest.status === "ENDED";
  const isSoon = quest.status === "COMING_SOON";
  const token = questRewardToken(quest);

  const statusMeta = QUEST_STATUS_BADGE[quest.status];
  const statusLabel =
    slots.full && quest.status === "ACTIVE"
      ? t("earnCampaigns.slotsEnded")
      : statusMeta.label;

  // Reward value (boxed row) — "0.05 CC · first-come" / "0.02 CC · winner".
  let rewardText: string;
  if (config.isDual) {
    rewardText =
      quest.rewardCc > 0
        ? `${formatRewardAmount(quest.rewardCc, token)} + Code`
        : `${token} + Code`;
  } else if (config.isCcToken && quest.rewardCc > 0) {
    rewardText = `${formatRewardAmount(quest.rewardCc, token)} · ${
      config.isFcfs ? "first-come" : "winner"
    }`;
  } else if (
    config.code === "INVITE_CODE_FCFS" ||
    config.code === "INVITE_CODE_RANDOM"
  ) {
    rewardText = "1 invite code";
  } else if (config.code === "WAITLIST_EMAIL") {
    rewardText = "Waitlist spot";
  } else {
    rewardText = quest.rewardPool ?? "—";
  }

  // USD estimasi (harga live) di bawah reward — hanya campaign berhadiah
  // token (CC / USDCx / dual CC+Code); invite code & waitlist tanpa nominal.
  const showRewardUsd = config.isCcToken && quest.rewardCc > 0;

  // CTA
  const ctaLabel = meta.joinBlocked
    ? t("earnCampaigns.slotsEnded")
    : isEnded
      ? "View Result"
      : completed
        ? t("quests.questComplete")
        : meta.hasParticipated && slots.full
          ? t("earnCampaigns.viewMyQuest")
          : t("quests.joinQuest");

  const ctaVariant: "primary" | "ghost" | "muted" =
    meta.joinBlocked
      ? "muted"
      : isEnded
        ? "ghost"
        : completed
          ? "primary"
          : meta.canOpen
            ? "primary"
            : "muted";

  const ctaClass =
    ctaVariant === "primary"
      ? "btn-brand-gradient font-bold"
      : ctaVariant === "ghost"
        ? "border border-white/[0.13] bg-transparent font-semibold text-[var(--foreground)] hover:opacity-90"
        : "border border-[var(--border)] bg-[var(--card-solid)] font-medium text-[var(--muted-foreground)] hover:opacity-90";

  // FCFS progress fill: gray utk ended/full, amber saat hampir habis, mint default.
  const progressFillClass = cn(
    "h-full rounded-full",
    isEnded || slots.full
      ? "bg-[var(--muted-foreground)]"
      : slots.warn
        ? "bg-gradient-to-r from-amber-600 to-amber-400"
        : "bg-gradient-to-r from-[rgb(var(--canton-rgb)/0.55)] to-[rgb(var(--canton-rgb))]",
  );

  // Urgency meta (kanan): countdown live utk ACTIVE, kalender utk lainnya.
  const urgencyText = quest.endsAt
    ? slots.full || isEnded
      ? (
        <span className="inline-flex items-center gap-1.5">
          <Calendar className="h-[13px] w-[13px]" />
          {isEnded ? "Ended" : "Ends"} {shortEndDate(quest)}
        </span>
      )
      : <CountdownTimer endsAt={quest.endsAt} />
    : quest.deadline
      ? (
        <span className="inline-flex items-center gap-1.5">
          <Calendar className="h-[13px] w-[13px]" />
          <span className="truncate max-w-[110px]">{quest.deadline}</span>
        </span>
      )
      : null;

  const showFcfsProgress = config.isFcfs && slots.max > 0;
  const showRaffleRow = !config.isFcfs && config.isRaffle && slots.max > 0;
  const raffleText =
    slots.used > 0
      ? `${slots.used} winners drawn`
      : `${slots.max} winners · draws ${shortEndDate(quest)}`;

  const inner = (
    <div
      className={cn(
        "group relative flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden rounded-[20px] border border-white/[0.07] bg-[var(--card)] transition-colors duration-300",
        meta.canOpen && !meta.joinBlocked && "hover:border-[var(--primary)]/30",
      )}
    >
      {/* ── Banner (104px) + status/type chips ─────────────────── */}
      <div className="relative h-[104px] w-full shrink-0 overflow-hidden">
        {quest.bannerImageUrl ? (
          <div
            className={cn(
              "absolute inset-0 bg-cover bg-center",
              isEnded && "grayscale brightness-[0.6]",
            )}
            style={{ backgroundImage: `url("${quest.bannerImageUrl}")` }}
          />
        ) : (
          /* Fallback: stripes + watermark huruf org (mockup banner-fallback) */
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, rgba(94,232,156,0.06) 0 2px, transparent 2px 14px), linear-gradient(160deg,#16211b,#0b0f0d)",
            }}
          >
            <span className="text-[30px] font-extrabold text-[rgb(var(--canton-rgb)/0.28)]">
              {quest.orgSlug.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
        {isEnded ? <div className="absolute inset-0 bg-[#060a08]/25" /> : null}
        {isSoon ? (
          <div className="absolute inset-0 z-[2] flex items-center justify-center bg-[#060a08]/35 backdrop-blur-[3px] saturate-[0.7]">
            <span className="rounded-full border border-white/[0.13] bg-[#060a08]/60 px-3 py-1.5 text-xs font-bold text-[var(--foreground)]">
              Coming soon
            </span>
          </div>
        ) : null}

        {/* Chips: status (kiri) · tipe reward (kanan) */}
        <div className="relative z-[3] flex w-full items-start justify-between px-3.5 py-3">
          <span
            className={cn(
              "inline-flex items-center gap-[5px] rounded-full border border-white/[0.12] bg-[#060a08]/55 px-[9px] py-[5px] text-[10px] font-bold uppercase tracking-[0.6px] text-[var(--foreground)] backdrop-blur-md",
              quest.status === "ACTIVE" &&
                !slots.full &&
                "border-[rgb(var(--canton-rgb)/0.3)] text-canton",
              quest.status === "COMING_SOON" &&
                "border-amber-300/30 text-amber-300",
            )}
          >
            <span
              className={cn(
                "h-[6px] w-[6px] rounded-full",
                quest.status === "ACTIVE"
                  ? slots.full
                    ? "bg-[var(--muted-foreground)]"
                    : "bg-[var(--primary)] shadow-[0_0_0_3px_rgb(var(--canton-rgb)/0.18)]"
                  : quest.status === "COMING_SOON"
                    ? "bg-amber-300"
                    : "bg-[var(--muted-foreground)]",
              )}
            />
            {statusLabel}
          </span>
          <span className="inline-flex items-center rounded-full border border-white/[0.12] bg-[#060a08]/55 px-[9px] py-[5px] text-[10px] font-bold uppercase tracking-[0.6px] text-[var(--muted-foreground)] backdrop-blur-md">
            {config.shortLabel}
          </span>
        </div>
      </div>

      {/* ── Head: logo 44px + judul & deskripsi satu baris ─────── */}
      <div className="flex items-center gap-3 px-4 pb-3.5 pt-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.13] bg-[var(--card-solid)] text-base font-bold text-canton">
          {quest.logoUrl ? (
            <img src={quest.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            quest.orgSlug.slice(0, 2).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-[15.5px] font-bold leading-tight",
              isEnded ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)]",
            )}
          >
            {quest.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
            {quest.description}
          </p>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col px-4 pb-4">
        {/* Reward row (boxed) */}
        <div className="mb-3 rounded-[10px] border border-[var(--border)] bg-[var(--card-solid)] px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.4px] text-[var(--muted-foreground)]/70">
            Reward
          </p>
          <p
            className={cn(
              "mt-0.5 font-mono text-sm font-bold",
              isEnded ? "text-[var(--muted-foreground)]" : "text-canton",
            )}
          >
            {rewardText}
          </p>
          {showRewardUsd ? (
            <TokenUsdValue
              amount={quest.rewardCc}
              token={token}
              className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]/80"
            />
          ) : null}
        </div>

        {/* FCFS progress ATAU raffle row */}
        {showFcfsProgress ? (
          <div className="mb-3.5">
            <div className="mb-[5px] flex justify-between text-[11px] text-[var(--muted-foreground)]/70">
              <span>
                {slots.used} / {slots.max} claimed
              </span>
              <span className="font-mono">{slots.pct}%</span>
            </div>
            <div className="h-[5px] overflow-hidden rounded-full bg-[var(--card-solid)]">
              <div
                className={progressFillClass}
                style={{ width: `${Math.max(slots.pct > 0 ? 2 : 0, slots.pct)}%` }}
              />
            </div>
          </div>
        ) : showRaffleRow ? (
          <p className="mb-3.5 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
            <Calendar className="h-[13px] w-[13px] text-[var(--muted-foreground)]/70" aria-hidden />
            {raffleText}
          </p>
        ) : null}

        {/* Meta row */}
        <div className="mb-3.5 mt-auto flex items-center gap-3.5 border-t border-[var(--border)] pt-3 text-[11.5px] text-[var(--muted-foreground)]/70">
          <span className="inline-flex items-center gap-[5px]">
            <ListChecks className="h-[13px] w-[13px]" aria-hidden />
            {quest.tasks.length} {quest.tasks.length === 1 ? "task" : "tasks"}
          </span>
          {urgencyText}
        </div>

        {/* CTA */}
        <span
          className={cn(
            "flex h-10 w-full items-center justify-center rounded-[9px] px-4 text-[13px] transition-all",
            ctaClass,
          )}
        >
          {ctaLabel}
        </span>
      </div>
    </div>
  );

  if (meta.joinBlocked || !meta.canOpen) return inner;

  return (
    <Link
      href={ROUTES.campaignQuest(quest.id, quest.title)}
      className="block h-full w-full min-w-0 max-w-full overflow-hidden rounded-[20px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
    >
      {inner}
    </Link>
  );
}
