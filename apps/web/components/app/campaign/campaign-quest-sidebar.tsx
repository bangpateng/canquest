import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { CcUsdValue } from "@/components/app/earn/cc-usd-value";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { formatCodePerWinners, formatCodePoolLabel } from "@/lib/canton/campaign-reward";
import type { Quest } from "@/lib/quest/quest-types";
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
  if (quest.endsAt) {
    return new Date(quest.endsAt).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).replace(",", ",");
  }
  return quest.deadline ?? "—";
}

/**
 * Campaign reward + meta — single clean hero block shown above quest tasks.
 * Type label lives in the page hero badge (no duplication here).
 */
export function CampaignQuestSidebar({ quest }: { quest: Quest }) {
  const meta = getQuestMeta(quest);
  const { config, rewardDisplay, slots, metrics } = meta;
  const summary = quest.campaignSummary;

  const VALUE_CLS = "text-base font-bold text-white";

  // ── Reward / winner value ──────────────────────────────────────
  let rewardPerWinner: React.ReactNode;
  if (config.isDual) {
    rewardPerWinner = (
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1.5">
          <CcRewardLogo size={18} />
          <span className={VALUE_CLS}>{quest.rewardCc > 0 ? `${quest.rewardCc} CC` : "CC"}</span>
        </div>
        <span className="text-sm font-semibold text-slate-500">+</span>
        <div className="flex items-center gap-1.5">
          <Ticket className="h-4 w-4 text-violet-300" aria-hidden />
          <span className={VALUE_CLS}>1 Code</span>
        </div>
      </div>
    );
  } else if (config.isCcToken) {
    rewardPerWinner = (
      <div className="flex items-center gap-1.5">
        <CcRewardLogo size={18} />
        <span className={VALUE_CLS}>
          {quest.rewardCc > 0 ? `${quest.rewardCc} CC` : rewardDisplay.primaryText}
        </span>
      </div>
    );
  } else if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM") {
    rewardPerWinner = (
      <div className="flex items-center gap-1.5">
        <Ticket className="h-4 w-4 text-violet-300" aria-hidden />
        <span className={VALUE_CLS}>{formatCodePerWinners()}</span>
      </div>
    );
  } else if (config.code === "WAITLIST_EMAIL") {
    rewardPerWinner = (
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden />
        <span className={VALUE_CLS}>Waitlist spot</span>
      </div>
    );
  } else {
    rewardPerWinner = <span className={VALUE_CLS}>{rewardDisplay.primaryText}</span>;
  }

  // ── Claim fee ──────────────────────────────────────────────────
  const claimFeeCc = summary?.fcfsClaimFeeCc ?? config.defaultClaimFee ?? 0;
  const claimFeeDisplay =
    config.code === "WAITLIST_EMAIL"
      ? null
      : claimFeeCc > 0
        ? `${claimFeeCc} CC`
        : "Free";

  // ── Pool label ─────────────────────────────────────────────────
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
    <section
      className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/40"
      aria-label="Campaign reward"
    >
      {/* ── Reward highlight (single hero block) ──────────────────── */}
      <div className="relative border-b border-white/[0.06]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_90%_at_0%_0%,rgb(var(--canton-rgb)/0.10),transparent_60%)]" />

        {/* Reward winner + Pool — 2 equal columns */}
        <div className="relative grid grid-cols-2 gap-px bg-white/[0.04]">
          {/* Reward · winner */}
          <div className="flex min-w-0 flex-col gap-1.5 bg-[#0a0c14]/90 px-5 py-4 sm:px-6 sm:py-5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-xs">
              Reward · winner
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {rewardPerWinner}
              {quest.rewardCc > 0 ? <CcUsdValue cc={quest.rewardCc} /> : null}
            </div>
          </div>

          {/* Reward Pool */}
          <div className="flex min-w-0 flex-col gap-1.5 bg-[#0a0c14]/90 px-5 py-4 sm:px-6 sm:py-5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-xs">
              Reward Pool
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {config.isCcToken ? (
                <>
                  <CcRewardLogo size={18} />
                  <span className={VALUE_CLS}>{poolDisplay}</span>
                  {poolCcValue > 0 ? <CcUsdValue cc={poolCcValue} /> : null}
                </>
              ) : config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM" ? (
                <>
                  <Ticket className="h-4 w-4 shrink-0 text-violet-400" />
                  <span className={VALUE_CLS}>{poolDisplay}</span>
                </>
              ) : (
                <>
                  <CcRewardLogo size={18} />
                  <span className={VALUE_CLS}>{poolDisplay}</span>
                  {summary?.poolTotalCc != null && summary.poolTotalCc > 0 ? (
                    <CcUsdValue cc={summary.poolTotalCc} />
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Claim fee row — single line, clear */}
        {claimFeeDisplay !== null ? (
          <div className="relative flex items-center gap-2 bg-[#0a0c14]/90 px-5 py-2.5 sm:px-6">
            <Zap className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
            <span className="text-xs font-semibold text-slate-400">Claim fee</span>
            <span className={cn(
              "ml-auto text-xs font-bold",
              claimFeeDisplay === "Free" ? "text-emerald-400" : "text-amber-300",
            )}>
              {claimFeeDisplay}
            </span>
          </div>
        ) : null}
      </div>

      {/* ── Slots progress (full-width when applicable) ──────────── */}
      {showSlotsProgress ? (
        <div className="border-b border-white/[0.04] px-5 py-3 sm:px-6">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-400">
              {isFcfsType ? <Zap className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
              {slotsLabel}
            </span>
            <span className="font-bold tabular-nums text-white">
              {slotsValue}{slotsHint ? <span className="ml-1.5 text-[10px] font-medium text-slate-500">{slotsHint}</span> : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
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

      {/* ── Metrics (3 columns) ──────────────────────────────────── */}
      <dl className="grid grid-cols-3 gap-px bg-white/[0.04]">
        <MetricTile
          icon={isFcfsType ? Zap : Users}
          label={slotsLabel}
          value={showSlotsProgress ? slotsValue : slotsValue}
        />
        <MetricTile icon={ListChecks} label="Tasks" value={String(quest.tasks.length)} />
        <MetricTile
          icon={quest.endsAt ? Clock : Calendar}
          label="Ends"
          value={formatEnd(quest)}
          small
        />
      </dl>
    </section>
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
    <div className="flex min-w-0 flex-col gap-1.5 bg-[#0a0c14]/90 px-4 py-3">
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <Icon className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className={cn(
        "truncate font-bold text-slate-100",
        small ? "text-xs leading-snug" : "text-sm",
      )}>
        {value}
      </dd>
    </div>
  );
}
