"use client";

import type { ReactNode } from "react";
import type { QuestCampaignSummary } from "@/lib/campaign-reward";
import {
  fcfsSlotsTaken,
  formatFcfsSlotsFilled,
  formatPoolTotalLabel,
  isFcfsSlotsFull,
} from "@/lib/campaign-reward";
import type { RewardType } from "@/lib/quest-types";
import { cn } from "@/lib/utils";
import {
  ArrowRightLeft,
  Coins,
  Layers,
  Sparkles,
  Ticket,
  Trophy,
  Zap,
} from "lucide-react";

function rewardAccent(rewardPool: string, rewardType?: RewardType) {
  const pool = rewardPool.toLowerCase();
  if (rewardType === "CC_ONLY" || rewardType === "CC_AND_INVITE" || pool.includes("cc")) {
    return {
      icon: Coins,
      hero: "from-[rgb(var(--canton-rgb)/0.22)] via-[rgb(var(--canton-cyan-rgb)/0.08)] to-transparent",
      border: "border-[var(--primary)]/35",
      stat: "text-canton",
    };
  }
  if (rewardType?.includes("INVITE") || pool.includes("invite") || pool.includes("fcfs")) {
    return {
      icon: Ticket,
      hero: "from-violet-500/25 via-fuchsia-500/10 to-transparent",
      border: "border-violet-500/35",
      stat: "text-violet-200",
    };
  }
  if (rewardType === "WAITLIST_EMAIL" || pool.includes("waitlist")) {
    return {
      icon: Sparkles,
      hero: "from-cyan-500/20 via-blue-500/8 to-transparent",
      border: "border-cyan-500/30",
      stat: "text-cyan-200",
    };
  }
  return {
    icon: Trophy,
    hero: "from-[rgb(var(--canton-rgb)/0.18)] to-transparent",
    border: "border-[rgb(var(--canton-rgb)/0.28)]",
    stat: "text-canton",
  };
}

function StatCell({
  icon: Icon,
  label,
  value,
  sub,
  accentClass,
  className,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  sub?: ReactNode;
  accentClass?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[4.25rem] flex-col justify-center gap-1 px-3 py-2.5",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        <Icon className={cn("h-3 w-3 shrink-0 opacity-80", accentClass)} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <p
        className={cn(
          "text-sm font-bold leading-tight tabular-nums text-[var(--foreground)]",
          accentClass,
        )}
      >
        {value}
      </p>
      {sub ? <div className="mt-0.5">{sub}</div> : null}
    </div>
  );
}

export function EarnCampaignRewardPanel({
  rewardCc,
  rewardPool,
  rewardType,
  summary,
  labels,
}: {
  rewardCc: number;
  rewardPool: string;
  rewardType?: RewardType;
  summary?: QuestCampaignSummary | null;
  labels: {
    rewardPerWinner: string;
    rewardLabel: string;
    fcfsSlots: string;
    poolTotal: string;
    claimFlow: string;
    claimFee: string;
    codesRemaining: string;
    invite: string;
    slotsEnded: string;
    slotsClaimed: string;
  };
}) {
  const accent = rewardAccent(rewardPool, rewardType);
  const HeroIcon = accent.icon;

  const showFcfsSlots =
    summary != null &&
    summary.maxWinners != null &&
    summary.maxWinners > 0 &&
    summary.remainingSlots != null;

  const showClaimFlow =
    summary != null &&
    summary.fcfsClaimFeeCc > 0 &&
    rewardCc > 0 &&
    (summary.requiresFcfsClaim || summary.requiresPaidInviteClaim);

  const poolLabel = formatPoolTotalLabel(summary?.poolTotalCc ?? null, rewardPool);
  const showPoolRow = poolLabel !== "—" || (summary?.poolTotalCc ?? 0) > 0;

  const showCodesRow =
    summary?.codesRemaining != null &&
    (rewardType === "INVITE_CODE_FCFS" || summary.requiresPaidInviteClaim);

  const hasRewardAmount = rewardCc > 0;
  const hasStats = showFcfsSlots || showPoolRow || showClaimFlow || showCodesRow;

  const statCount =
    (showFcfsSlots ? 1 : 0) +
    (showPoolRow ? 1 : 0) +
    (showClaimFlow ? 1 : 0) +
    (showCodesRow ? 1 : 0);

  const slotsMax = summary?.maxWinners ?? 0;
  const slotsLeft = summary?.remainingSlots ?? 0;
  const slotsUsed = fcfsSlotsTaken(slotsLeft, slotsMax);
  const slotsFull =
    summary?.slotsFull ?? isFcfsSlotsFull(slotsLeft, slotsMax);
  const slotsPct =
    showFcfsSlots && slotsMax > 0
      ? Math.round((slotsUsed / slotsMax) * 100)
      : 0;

  if (!hasRewardAmount && !hasStats) {
    return (
      <div
        className={cn(
          "mt-3 flex items-center gap-3 rounded-xl border bg-[var(--muted)]/30 px-4 py-3",
          accent.border,
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/20">
          <HeroIcon className="h-5 w-5 text-[var(--muted-foreground)]" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            {labels.rewardLabel}
          </p>
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">{rewardPool}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-xl border bg-[var(--card)]/80 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]",
        accent.border,
      )}
    >
      {/* Hero reward */}
      {hasRewardAmount ? (
        <div
          className={cn(
            "relative flex items-center gap-3 bg-gradient-to-r px-4 py-3.5",
            accent.hero,
          )}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/25 ring-1 ring-white/10">
            <HeroIcon className={cn("h-5 w-5", accent.stat)} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              {labels.rewardPerWinner}
            </p>
            <p className="mt-0.5 flex items-baseline gap-1.5">
              <span
                className={cn(
                  "text-[1.75rem] font-bold leading-none tracking-tight tabular-nums sm:text-3xl",
                  accent.stat,
                )}
              >
                {rewardCc}
              </span>
              <span className="text-sm font-semibold text-[var(--muted-foreground)]">CC</span>
            </p>
          </div>
        </div>
      ) : null}

      {/* Stats grid */}
      {hasStats ? (
        <div
          className={cn(
            "grid divide-[var(--border)] border-t border-[var(--border)] bg-[var(--muted)]/20",
            statCount === 1 && "grid-cols-1",
            statCount === 2 && "grid-cols-2 divide-x",
            statCount >= 3 && "grid-cols-2 divide-x sm:grid-cols-3",
          )}
        >
          {showFcfsSlots ? (
            <StatCell
              icon={Zap}
              label={labels.fcfsSlots}
              value={formatFcfsSlotsFilled(
                slotsLeft,
                summary!.maxWinners,
                labels.slotsEnded,
              )}
              accentClass={
                slotsFull
                  ? "text-[var(--muted-foreground)]"
                  : "text-[var(--primary-strong)]"
              }
              sub={
                slotsFull ? null : (
                  <div className="space-y-1">
                    <div className="h-1 overflow-hidden rounded-full bg-[var(--border)]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          slotsLeft <= 1
                            ? "bg-gradient-to-r from-amber-500 to-orange-500"
                            : "bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)]",
                        )}
                        style={{ width: `${Math.max(4, slotsPct)}%` }}
                      />
                    </div>
                    <p className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
                      {labels.slotsClaimed}
                    </p>
                  </div>
                )
              }
              className={statCount >= 3 ? "sm:border-r sm:border-[var(--border)]" : undefined}
            />
          ) : null}

          {showPoolRow ? (
            <StatCell
              icon={Layers}
              label={labels.poolTotal}
              value={poolLabel}
              accentClass={accent.stat}
            />
          ) : null}

          {showClaimFlow ? (
            <StatCell
              icon={ArrowRightLeft}
              label={labels.claimFee}
              value={`${summary!.fcfsClaimFeeCc} CC`}
              accentClass="text-[var(--foreground)]"
              sub={
                <p className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                  <span className="font-medium text-[var(--foreground)]">
                    {summary!.fcfsClaimFeeCc}
                  </span>
                  <span aria-hidden>→</span>
                  <span className={cn("font-semibold", accent.stat)}>{rewardCc} CC</span>
                </p>
              }
              className={cn(
                statCount === 2 && showFcfsSlots && !showPoolRow && "col-span-2 sm:col-span-1",
                statCount >= 3 && "col-span-2 border-t border-[var(--border)] sm:col-span-1 sm:border-t-0",
              )}
            />
          ) : null}

          {showCodesRow ? (
            <StatCell
              icon={Ticket}
              label={labels.invite}
              value={labels.codesRemaining}
              accentClass="text-violet-200"
            />
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
