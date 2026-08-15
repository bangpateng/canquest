import { RewardTokenLogo } from "@/components/app/campaign/reward-token-logo";
import { CcUsdValue } from "@/components/app/earn/cc-usd-value";
import { getQuestMeta } from "@/lib/quest/quest-engine";
import { formatCodePoolLabel, formatRewardAmount } from "@/lib/canton/campaign-reward";
import { questRewardToken } from "@/lib/quest/quest-types";
import type { Quest } from "@/lib/quest/quest-types";
import { Card } from "@/components/ui/card";
import { Sparkles, Ticket } from "lucide-react";

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
 * Campaign reward sidebar — mockup `Your Reward` glass-card (sticky on lg).
 *
 * Layout mirrors mockup renderEarnDetail: reward hero (icon + amount),
 * divider, Slots + Ends In two-column grid with mini progress bar,
 * divider, Claim fee / Reward pool / Tasks rows. All values come from
 * quest-engine — no fabricated data.
 */
export function CampaignQuestSidebar({ quest }: { quest: Quest }) {
  const token = questRewardToken(quest);
  const meta = getQuestMeta(quest);
  const { config, rewardDisplay, slots } = meta;
  const summary = quest.campaignSummary;

  const REWARD_CLS = "text-xl font-bold leading-tight text-[var(--foreground)]";

  // ── Reward hero value (mockup rewardCell) ─────────────────────
  let rewardPerWinner: React.ReactNode;
  if (config.isDual) {
    rewardPerWinner = (
      <div className={REWARD_CLS}>
        {quest.rewardCc > 0 ? formatRewardAmount(quest.rewardCc, token) : token}{" "}
        <span className="text-[var(--muted-foreground)]">+</span> 1 Code
      </div>
    );
  } else if (config.isCcToken) {
    rewardPerWinner = (
      <div className={REWARD_CLS}>
        {quest.rewardCc > 0 ? formatRewardAmount(quest.rewardCc, token) : rewardDisplay.primaryText}
      </div>
    );
  } else if (config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM") {
    rewardPerWinner = <div className={REWARD_CLS}>1 Invite Code</div>;
  } else if (config.code === "WAITLIST_EMAIL") {
    rewardPerWinner = <div className={REWARD_CLS}>Waitlist Spot</div>;
  } else {
    rewardPerWinner = <div className={REWARD_CLS}>{rewardDisplay.primaryText}</div>;
  }

  // ── Reward hero icon box (mockup tc.iconBg + icon) ────────────
  const isCodeReward =
    config.code === "INVITE_CODE_FCFS" || config.code === "INVITE_CODE_RANDOM";
  const rewardIcon = config.isCcToken ? (
    <RewardTokenLogo token={token} size={24} />
  ) : config.code === "WAITLIST_EMAIL" ? (
    <Sparkles className="h-6 w-6 text-cyan-300" aria-hidden />
  ) : (
    <Ticket className="h-6 w-6 text-violet-400" aria-hidden />
  );

  // ── Claim fee ──────────────────────────────────────────────────
  const claimFeeCc = summary?.fcfsClaimFeeCc ?? config.defaultClaimFee ?? 0;
  const claimFeeDisplay =
    config.code === "WAITLIST_EMAIL"
      ? null
      : claimFeeCc > 0
        ? `${claimFeeCc} CC`
        : "Free";

  // ── Reward pool ────────────────────────────────────────────────
  const poolMetric = meta.metrics.find((m) => m.key === "pool");
  const poolDisplay = isCodeReward
    ? formatCodePoolLabel(quest.maxWinners, summary?.codesRemaining)
    : poolMetric
      ? poolMetric.value
      : rewardDisplay.poolLabel;

  // ── Slots metric (FCFS slots / winners drawn / max winners) ────
  const isFcfsType =
    config.code === "CC_ONLY" || config.code === "INVITE_CODE_FCFS";

  let slotsValue: string;
  let slotsPct = 0;
  if (slots.max > 0 && (isFcfsType || slots.used > 0)) {
    slotsValue = `${slots.used}/${slots.max}`;
    slotsPct = slots.pct;
  } else {
    slotsValue = slots.max > 0 ? `${slots.max} max` : "—";
  }

  return (
    <Card className="w-full overflow-hidden" aria-label="Campaign reward">
      <div className="flex flex-col gap-4 p-5">
        {/* ── Reward hero ────────────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
            Your Reward
          </p>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-canton-subtle">
              {rewardIcon}
            </span>
            <div className="min-w-0">
              {rewardPerWinner}
              {quest.rewardCc > 0 ? (
                <div className="mt-0.5">
                  <CcUsdValue cc={quest.rewardCc} />
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="h-px bg-white/5" aria-hidden />

        {/* ── Slots + Ends In (two-column grid) ─────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              Slots
            </p>
            <p className="mt-1 text-sm font-bold tabular-nums text-[var(--foreground)]">
              {slotsValue}
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className={slots.full ? "h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" : "h-full rounded-full bg-gradient-brand"}
                style={{ width: `${Math.max(slotsPct > 0 ? 6 : 0, slotsPct)}%` }}
              />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              {quest.status === "ACTIVE" ? "Ends In" : quest.status === "ENDED" ? "Ended" : "Starts"}
            </p>
            <p className="mt-1 text-sm font-bold text-amber-300">{formatEnd(quest)}</p>
          </div>
        </div>

        <div className="h-px bg-white/5" aria-hidden />

        {/* ── Fee / pool / tasks rows ───────────────────────────── */}
        {claimFeeDisplay !== null ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--muted-foreground)]">Claim Fee</span>
            <span
              className={
                claimFeeDisplay === "Free"
                  ? "text-xs font-bold text-canton"
                  : "text-xs font-bold text-[var(--foreground)]"
              }
            >
              {claimFeeDisplay}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--muted-foreground)]">Reward Pool</span>
          <span className="truncate text-xs font-bold text-[var(--foreground)]">{poolDisplay}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--muted-foreground)]">Tasks</span>
          <span className="text-xs font-bold tabular-nums text-[var(--foreground)]">
            {quest.tasks.length}
          </span>
        </div>
      </div>
    </Card>
  );
}
