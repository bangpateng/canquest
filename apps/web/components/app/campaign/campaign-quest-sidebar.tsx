import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { CcUsdValue } from "@/components/app/earn/cc-usd-value";
import { CampaignSocialLinks } from "@/components/app/campaign/campaign-social-links";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { isCcTokenRewardQuest } from "@/lib/canton/cc-reward-logo";
import { formatCodePerWinners } from "@/lib/canton/campaign-reward";
import type { Quest } from "@/lib/quest/quest-types";
import { cn } from "@/lib/utils/utils";
import {
  Calendar,
  Clock,
  Coins,
  ListChecks,
  Sparkles,
  Ticket,
  Trophy,
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

type Tile = {
  key: string;
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string | null;
  tone?: "default" | "canton" | "violet" | "amber" | "muted";
  progress?: { used: number; max: number; warn?: boolean } | null;
};

const TONE_TEXT: Record<NonNullable<Tile["tone"]>, string> = {
  default: "text-white",
  canton: "text-canton",
  violet: "text-violet-300",
  amber: "text-amber-300",
  muted: "text-slate-400",
};

/** Map metric iconKind from quest-engine to LucideIcon. */
function resolveIcon(kind: string): LucideIcon {
  switch (kind) {
    case "cc": return Coins;
    case "zap": return Zap;
    case "users": return Users;
    case "ticket": return Ticket;
    case "sparkles": return Sparkles;
    default: return Trophy;
  }
}

/** Map metric accent class to sidebar tile tone. */
function resolveTone(accent?: string, muted?: boolean): Tile["tone"] {
  if (muted) return "muted";
  if (!accent) return "default";
  if (accent.includes("violet")) return "violet";
  if (accent.includes("amber")) return "amber";
  if (accent.includes("canton")) return "canton";
  return "default";
}

/**
 * Campaign reward + meta — type-aware highlight panel shown above quest tasks.
 * Uses getQuestMeta from quest-engine for all derived state.
 */
export function CampaignQuestSidebar({ quest }: { quest: Quest }) {
  const meta = getQuestMeta(quest);
  const { config, rewardDisplay, slots, metrics } = meta;
  const summary = quest.campaignSummary;

  // ── Reward / winner value ──────────────────────────────────────
  let rewardPerWinner: React.ReactNode;
  if (config.isDual) {
    rewardPerWinner = (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <CcRewardLogo size={20} />
          <span className="text-xl font-bold text-white">
            {quest.rewardCc > 0 ? `${quest.rewardCc} CC` : "CC"}
          </span>
        </div>
        <span className="text-lg font-bold text-slate-500">+</span>
        <div className="flex items-center gap-1.5">
          <Ticket className="h-5 w-5 text-violet-300" aria-hidden />
          <span className="text-xl font-bold text-violet-300">1 Code</span>
        </div>
      </div>
    );
  } else if (isCcTokenRewardQuest(quest)) {
    rewardPerWinner = (
      <div className="flex items-center gap-2">
        <CcRewardLogo size={20} />
        <span className="text-xl font-bold text-canton">
          {quest.rewardCc > 0 ? `${quest.rewardCc} CC` : rewardDisplay.primaryText}
        </span>
      </div>
    );
  } else if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM") {
    rewardPerWinner = (
      <div className="flex items-center gap-2">
        <Ticket className="h-5 w-5 text-violet-300" aria-hidden />
        <span className="text-xl font-bold text-violet-300">{formatCodePerWinners()}</span>
      </div>
    );
  } else if (config.code === "WAITLIST_EMAIL") {
    rewardPerWinner = (
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-cyan-300" aria-hidden />
        <span className="text-xl font-bold text-cyan-300">Waitlist spot</span>
      </div>
    );
  } else {
    rewardPerWinner = (
      <span className="text-xl font-bold text-white">{rewardDisplay.primaryText}</span>
    );
  }

  // ── Claim fee ──────────────────────────────────────────────────
  const claimFeeCc = summary?.fcfsClaimFeeCc ?? config.defaultClaimFee ?? 0;
  const claimFeeDisplay =
    config.code === "WAITLIST_EMAIL"
      ? null // no claim fee row for email raffle
      : claimFeeCc > 0
        ? `${claimFeeCc} CC`
        : "Free";

  // ── Pool label ─────────────────────────────────────────────────
  const poolMetric = metrics.find((m) => m.key === "pool");
  const poolDisplay = poolMetric ? poolMetric.value : rewardDisplay.poolLabel;

  // ── Metric columns ─────────────────────────────────────────────
  // Left: FCFS slots (with progress) or Max winners
  // Center: Tasks
  // Right: Ends
  const isFcfsType =
    config.code === "CC_ONLY" || config.code === "INVITE_CODE_FCFS";

  let leftLabel: string;
  let leftValue: string;
  let leftHint: string | null = null;
  let leftProgress: { used: number; max: number; warn?: boolean } | null = null;

  if (isFcfsType && slots.max > 0) {
    leftLabel = "FCFS slots";
    leftValue = slots.filledLabel;
    leftHint = slots.full ? "All slots claimed" : `${slots.left} left`;
    leftProgress =
      !slots.full && summary != null
        ? { used: slots.used, max: slots.max, warn: slots.warn }
        : null;
  } else if (config.code === "INVITE_CODE_RANDOM" && slots.used > 0) {
    leftLabel = "Winners drawn";
    leftValue = `${slots.used}/${slots.max}`;
    leftProgress = { used: slots.used, max: slots.max };
  } else {
    leftLabel = "Max winners";
    leftValue = slots.max > 0 ? String(slots.max) : "—";
  }

  return (
    <section
      className="relative w-full overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/40"
      aria-label="Campaign reward"
    >
      {/* ── SECTION 2 — Reward highlight ──────────────────────────────── */}
      <div className="relative border-b border-white/[0.06]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_90%_at_0%_0%,rgb(var(--canton-rgb)/0.12),transparent_60%)]" />

        {/* Reward / winner + Claim fee row */}
        <div className="relative grid grid-cols-2 gap-px bg-white/[0.04]">
          {/* Left: Reward / winner */}
          <div className="flex min-w-0 flex-col gap-1.5 bg-[#0a0c14]/90 px-5 py-4 sm:px-6 sm:py-5">
            <span className="text-[10px] font-semibold text-slate-500 sm:text-xs">
              Reward · winner
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {rewardPerWinner}
              {quest.rewardCc > 0 ? <CcUsdValue cc={quest.rewardCc} /> : null}
            </div>
          </div>

          {/* Right: Reward Pool */}
          <div className="flex min-w-0 flex-col gap-1.5 bg-[#0a0c14]/90 px-5 py-4 sm:px-6 sm:py-5">
            <span className="text-[10px] font-semibold text-slate-500 sm:text-xs">
              Reward Pool
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <CcRewardLogo size={20} />
              <span className="text-xl font-bold text-canton">
                {poolDisplay}
              </span>
              {summary?.poolTotalCc != null && summary.poolTotalCc > 0 ? (
                <CcUsdValue cc={summary.poolTotalCc} />
              ) : null}
            </div>
          </div>
        </div>

        {/* Type badge + Pool row */}
        <div className="relative flex items-center gap-3 bg-[#0a0c14]/90 px-5 py-2.5 sm:px-6">
          <span className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:text-xs",
            config.chipClass,
          )}>
            <Trophy className="h-3 w-3" aria-hidden />
            {config.shortLabel}
          </span>
          {slots.full && slots.isFcfs ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:text-xs">
              Slots full
            </span>
          ) : null}
          {claimFeeDisplay !== null ? (
            <span className="ml-auto text-[10px] font-semibold text-slate-400 sm:text-xs">
              Fee:{" "}
              <span className={claimFeeDisplay === "Free" ? "text-emerald-400" : "text-amber-300"}>
                {claimFeeDisplay}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {/* ── SECTION 3 — Metrics (3 columns) ───────────────────────────── */}
      <dl className="grid grid-cols-3 gap-px border-b border-white/[0.04] bg-white/[0.04]">
        {/* Left: FCFS slots or Max winners */}
        <div className="flex min-w-0 flex-col gap-1.5 bg-[#0a0c14]/90 px-4 py-3">
          <dt className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
            {isFcfsType ? (
              <Zap className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            ) : (
              <Users className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            )}
            <span className="truncate">{leftLabel}</span>
          </dt>
          <dd className="truncate text-sm font-bold text-slate-100">
            {leftValue}
            {leftHint ? (
              <span className="ml-1 text-[10px] font-medium text-slate-500">{leftHint}</span>
            ) : null}
          </dd>
          {leftProgress ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  leftProgress.warn
                    ? "bg-gradient-to-r from-amber-500 to-orange-500"
                    : "bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)]",
                )}
                style={{
                  width: `${Math.max(6, Math.min(100, Math.round((leftProgress.used / Math.max(1, leftProgress.max)) * 100)))}%`,
                }}
              />
            </div>
          ) : null}
        </div>

        {/* Center: Tasks */}
        <div className="flex min-w-0 flex-col gap-1.5 bg-[#0a0c14]/90 px-4 py-3">
          <dt className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
            <ListChecks className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">Tasks</span>
          </dt>
          <dd className="truncate text-sm font-bold text-slate-100">
            {quest.tasks.length}
          </dd>
        </div>

        {/* Right: Ends */}
        <div className="flex min-w-0 flex-col gap-1.5 bg-[#0a0c14]/90 px-4 py-3">
          <dt className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
            {quest.endsAt ? (
              <Clock className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            ) : (
              <Calendar className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
            )}
            <span className="truncate">Ends</span>
          </dt>
          <dd className="truncate text-xs font-bold leading-snug text-slate-100">
            {formatEnd(quest)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
