import { RewardTokenLogo } from "@/components/app/campaign/reward-token-logo";
import { TokenUsdValue } from "@/components/app/earn/cc-usd-value";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { formatCodePerWinners, formatCodePoolLabel, formatEndMeta, formatRewardAmount } from "@/lib/canton/campaign-reward";
import { questRewardToken } from "@/lib/quest/quest-types";
import type { Quest } from "@/lib/quest/quest-types";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";
import {
  Calendar,
  Clock,
  ListChecks,
  Sparkles,
  Ticket,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Compact date format: "Jun 15, 21:39" */
function formatEnd(quest: Quest): string {
  return formatEndMeta(quest.endsAt) ?? quest.deadline ?? "—";
}

/**
 * Campaign reward + meta — single clean hero block shown above quest tasks.
 * Type label lives in the page hero badge (no duplication here).
 */
export function CampaignQuestSidebar({ quest }: { quest: Quest }) {
  const token = questRewardToken(quest);
  const meta = getQuestMeta(quest);
  const { config, rewardDisplay, slots, metrics } = meta;
  const summary = quest.campaignSummary;

  const VALUE_CLS = "text-base font-bold text-[var(--foreground)]";

  // ── Reward / winner value ──────────────────────────────────────
  let rewardPerWinner: React.ReactNode;
  if (config.isDual) {
    rewardPerWinner = (
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1.5">
          <RewardTokenLogo token={token} size={18} />
          <span className={VALUE_CLS}>{quest.rewardCc > 0 ? formatRewardAmount(quest.rewardCc, token) : token}</span>
        </div>
        <span className="text-sm font-semibold text-[var(--muted-foreground)]">+</span>
        <div className="flex items-center gap-1.5">
          <Ticket className="h-4 w-4 text-canton" aria-hidden />
          <span className={VALUE_CLS}>1 Code</span>
        </div>
      </div>
    );
  } else if (config.isCcToken) {
    rewardPerWinner = (
      <div className="flex items-center gap-1.5">
        <RewardTokenLogo token={token} size={18} />
        <span className={VALUE_CLS}>
          {quest.rewardCc > 0 ? formatRewardAmount(quest.rewardCc, token) : rewardDisplay.primaryText}
        </span>
      </div>
    );
  } else if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM") {
    rewardPerWinner = (
      <div className="flex items-center gap-1.5">
        <Ticket className="h-4 w-4 text-canton" aria-hidden />
        <span className={VALUE_CLS}>{formatCodePerWinners()}</span>
      </div>
    );
  } else if (config.code === "WAITLIST_EMAIL") {
    rewardPerWinner = (
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-4 w-4 text-canton" aria-hidden />
        <span className={VALUE_CLS}>Waitlist spot</span>
      </div>
    );
  } else {
    rewardPerWinner = <span className={VALUE_CLS}>{rewardDisplay.primaryText}</span>;
  }

  // ── Pool label ─────────────────────────────────────────────────
  // (Claim fee TIDAK ditampilkan di sini — sudah ada di claim modal.)
  const isCodeReward =
    config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM";
  const poolMetric = metrics.find((m) => m.key === "pool");
  const poolDisplay = isCodeReward
    ? formatCodePoolLabel(quest.maxWinners, summary?.codesRemaining)
    : poolMetric
      ? poolMetric.value
      : rewardDisplay.poolLabel;
  const poolCcValue = summary?.poolTotalCc ?? 0;

  // ── Left metric: FCFS slots / winners ──────────────────────────
  const isFcfsType =
    config.code === "CC_ONLY" || config.code === "INVITE_CODE_FCFS";

  let slotsLabel: string;
  let slotsValue: string;
  let slotsHint: string | null = null;
  let showSlotsProgress = false;
  let slotsUsed = 0;
  let slotsMax = 0;

  if (isFcfsType && slots.max > 0) {
    slotsLabel = "FCFS slots";
    slotsValue = slots.filledLabel;
    slotsHint = slots.full ? "All slots claimed" : `${slots.left} left`;
    showSlotsProgress = !slots.full && summary != null;
    slotsUsed = slots.used;
    slotsMax = slots.max;
  } else if (config.code === "INVITE_CODE_RANDOM" && slots.used > 0) {
    slotsLabel = "Winners drawn";
    slotsValue = `${slots.used}/${slots.max}`;
    showSlotsProgress = true;
    slotsUsed = slots.used;
    slotsMax = slots.max;
  } else {
    slotsLabel = "Max winners";
    slotsValue = slots.max > 0 ? String(slots.max) : "—";
  }

  return (
    <Card
      className="w-full overflow-hidden"
      aria-label="Campaign reward"
    >
      {/* ── Reward highlight (single hero block) ──────────────────── */}
      <div className="border-b border-[var(--border)]">
        {/* Reward winner + Pool — 2 equal columns */}
        <div className="relative grid grid-cols-2 gap-px bg-[var(--border)]">
          {/* Reward · winner */}
          <div className="flex min-w-0 flex-col gap-1.5 bg-[var(--card)] px-5 py-4 sm:px-6 sm:py-5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Reward · winner
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {rewardPerWinner}
              {quest.rewardCc > 0 ? (
                <TokenUsdValue amount={quest.rewardCc} token={token} />
              ) : null}
            </div>
          </div>

          {/* Reward Pool */}
          <div className="flex min-w-0 flex-col gap-1.5 bg-[var(--card)] px-5 py-4 sm:px-6 sm:py-5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Reward Pool
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {config.isCcToken ? (
                <>
                  <RewardTokenLogo token={token} size={18} />
                  <span className={VALUE_CLS}>{poolDisplay}</span>
                  {poolCcValue > 0 ? (
                    <TokenUsdValue amount={poolCcValue} token={token} />
                  ) : null}
                </>
              ) : config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM" ? (
                <>
                  <Ticket className="h-4 w-4 shrink-0 text-canton" />
                  <span className={VALUE_CLS}>{poolDisplay}</span>
                </>
              ) : (
                <>
                  <RewardTokenLogo token={token} size={18} />
                  <span className={VALUE_CLS}>{poolDisplay}</span>
                  {summary?.poolTotalCc != null && summary.poolTotalCc > 0 ? (
                    <TokenUsdValue amount={summary.poolTotalCc} token={token} />
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Slots progress (full-width when applicable) ──────────── */}
      {showSlotsProgress ? (
        <div className="relative border-b border-[var(--border)] px-5 py-3 sm:px-6">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--muted-foreground)]">
              {isFcfsType ? <Zap className="h-3.5 w-3.5 text-canton" /> : <Users className="h-3.5 w-3.5 text-canton" />}
              {slotsLabel}
            </span>
            <span className="font-bold tabular-nums text-[var(--foreground)]">
              {slotsValue}{slotsHint ? <span className="ml-1.5 text-[10px] font-medium text-[var(--muted-foreground)]">{slotsHint}</span> : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                slots.warn
                  ? "bg-gradient-to-r from-amber-500 to-orange-500"
                  : "bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)]",
              )}
              style={{
                width: `${Math.max(6, Math.min(100, Math.round((slotsUsed / Math.max(1, slotsMax)) * 100)))}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {/* ── Metrics ─────────────────────────────────────────────────
          Saat section slots progress di atas sudah tampil (FCFS slots /
          Winners drawn + bar), label slots TIDAK diulang di sini —
          mencegah duplikasi "FCFS slots" double. */}
      <dl
        className={cn(
          "relative grid gap-px bg-[var(--border)]",
          showSlotsProgress ? "grid-cols-2" : "grid-cols-3",
        )}
      >
        {!showSlotsProgress ? (
          <MetricTile
            icon={isFcfsType ? Zap : Users}
            label={slotsLabel}
            value={slotsValue}
          />
        ) : null}
        <MetricTile icon={ListChecks} label="Tasks" value={String(quest.tasks.length)} />
        <MetricTile
          icon={quest.endsAt ? Clock : Calendar}
          label="Ends"
          value={formatEnd(quest)}
          small
        />
      </dl>
    </Card>
  );
}

/** Single metric tile in the 3-column metrics row. */
function MetricTile({
  icon: Icon,
  label,
  value,
  small = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-[var(--card)] px-4 py-3">
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        <Icon className="h-3 w-3 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className={cn(
        "truncate font-bold text-[var(--foreground)]",
        small ? "text-xs leading-snug" : "text-sm",
      )}>
        {value}
      </dd>
    </div>
  );
}
