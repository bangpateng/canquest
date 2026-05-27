import type {
  Quest,
  QuestRewardState,
  QuestRewardStatus,
  RewardType,
  UserProgress,
} from "@/lib/quest-types";

export type CampaignMeta = {
  ended: boolean;
  endsAt: string | null;
  remainingSlots: number | null;
  maxWinners: number | null;
  slotsTaken?: number | null;
  slotsFull?: boolean;
  fcfsClaimFeeCc: number;
  requiresFcfsClaim: boolean;
  requiresDrawCcClaim?: boolean;
  requiresPaidInviteClaim?: boolean;
  codesRemaining?: number | null;
};

/** Earn list cards — mirrors API `campaignSummary` on GET /quests */
export type QuestCampaignSummary = {
  requiresFcfsClaim: boolean;
  requiresDrawCcClaim?: boolean;
  requiresPaidInviteClaim: boolean;
  maxWinners: number | null;
  remainingSlots: number | null;
  slotsTaken?: number | null;
  slotsFull?: boolean;
  fcfsClaimFeeCc: number;
  poolTotalCc: number | null;
  codesRemaining: number | null;
};

export function formatPoolTotalLabel(poolTotalCc: number | null, rewardPool: string): string {
  if (poolTotalCc != null && poolTotalCc > 0) return `${poolTotalCc} CC`;
  return rewardPool.trim() || "—";
}

/** e.g. `10 CC / Winners` — campaign reward line under pool total. */
export function formatCcPerWinners(rewardCc: number): string {
  if (rewardCc <= 0) return "";
  return `${rewardCc} CC / Winners`;
}

export function sumQuestTaskPoints(tasks: { points: number }[]): number {
  return tasks.reduce((sum, t) => sum + t.points, 0);
}

/** Admin sometimes types total quest points (e.g. 40) in reward pool — not CC. */
export function isLikelyPointsPoolLabel(
  rewardPool: string,
  taskPointsSum: number,
): boolean {
  const trimmed = rewardPool.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  return Number(trimmed) === taskPointsSum;
}

/**
 * Campaign reward hero — CC for winners, not quest points (points stay on tasks + leaderboard).
 */
export function getCampaignRewardHeadline(
  quest: Pick<Quest, "rewardCc" | "rewardPool" | "tasks" | "rewardType">,
  poolTotalCc: number | null | undefined,
): { primary: string; secondary: string | null } {
  const ptsSum = sumQuestTaskPoints(quest.tasks);

  if (quest.rewardCc > 0) {
    const perWinner = formatCcPerWinners(quest.rewardCc);
    const pool =
      poolTotalCc != null && poolTotalCc > 0 ? `${poolTotalCc} CC Reward Pool` : null;
    return { primary: perWinner, secondary: pool };
  }

  if (isLikelyPointsPoolLabel(quest.rewardPool, ptsSum)) {
    return {
      primary: "Leaderboard points from tasks",
      secondary: `+${ptsSum} pts total across tasks`,
    };
  }

  const label = formatPoolTotalLabel(poolTotalCc ?? null, quest.rewardPool);
  return { primary: label, secondary: null };
}

export function getCampaignEndDate(quest: Quest): Date | null {
  const raw = quest.endsAt ?? quest.deadline ?? null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isCampaignEnded(quest: Quest, meta?: CampaignMeta | null): boolean {
  if (meta?.ended != null) return meta.ended;
  const end = getCampaignEndDate(quest);
  return end != null && end < new Date();
}

export function isUnluckyState(state: QuestRewardState | undefined): boolean {
  return state === "not_winner" || state === "fcfs_missed";
}

export function isWinnerState(state: QuestRewardState | undefined): boolean {
  return (
    state === "winner" ||
    state === "winner_fcfs" ||
    state === "cc_reward" ||
    state === "fcfs_claimable"
  );
}

export function rewardCodeFromStatus(status: QuestRewardStatus | null): string | null {
  return status?.inviteCode?.trim() || null;
}

export function fcfsSlotsTaken(
  remaining: number | null | undefined,
  maxWinners: number | null | undefined,
): number {
  const max = maxWinners ?? 0;
  if (max <= 0) return 0;
  const left = Math.max(0, Math.min(remaining ?? max, max));
  return max - left;
}

export function isFcfsSlotsFull(
  remaining: number | null | undefined,
  maxWinners: number | null | undefined,
): boolean {
  const max = maxWinners ?? 0;
  if (max <= 0) return false;
  return fcfsSlotsTaken(remaining, maxWinners) >= max;
}

/** Earn cards: winners claimed / max (0/2, 1/2). Shows "Ended" when full. */
export function formatFcfsSlotsFilled(
  remaining: number | null | undefined,
  maxWinners: number | null | undefined,
  endedLabel = "Ended",
): string {
  const max = maxWinners ?? 0;
  if (max <= 0) return "—";
  if (isFcfsSlotsFull(remaining, maxWinners)) return endedLabel;
  const taken = fcfsSlotsTaken(remaining, maxWinners);
  return `${taken}/${max}`;
}

/** Claim UI — slots still available */
export function formatFcfsSlotsRemaining(
  remaining: number,
  maxWinners: number | null | undefined,
): string {
  const max = maxWinners ?? 0;
  if (max <= 0) return "—";
  const left = Math.max(0, Math.min(remaining, max));
  if (left <= 0) return "Ended";
  return `${formatFcfsSlotsFilled(remaining, maxWinners)} · ${left} left`;
}

export function hasParticipatedInQuest(
  quest: Pick<Quest, "id" | "tasks">,
  progress: UserProgress | null | undefined,
): boolean {
  if (!progress) return false;
  if (progress.completedQuestIds.includes(quest.id)) return true;
  const taskIds = new Set(quest.tasks.map((t) => t.id));
  if (progress.submittedTaskIds.some((id) => taskIds.has(id))) return true;
  return progress.submissions.some((s) => taskIds.has(s.taskId));
}

export function formatFcfsClaimFeeHint(feeCc: number, rewardCc: number): string {
  return `Pay ${feeCc} CC claim fee on-chain to receive ${rewardCc} CC from the pool`;
}

export function campaignTypeDisplayValue(
  uiKind: ReturnType<typeof campaignUiKind>,
  rewardType?: string | null,
): string {
  switch (uiKind) {
    case "cc_fcfs":
      return "FCFS";
    case "cc_manual_draw":
      return "CC Raffle";
    case "waitlist_email":
      return "Waitlist";
    case "waitlist_code":
      return rewardType === "INVITE_CODE_FCFS" ? "Code FCFS" : "Code Raffle";
    case "cc_manual":
      return "CC Manual";
    default:
      return "Campaign";
  }
}

export function campaignUiKind(
  rewardType: RewardType | string | undefined,
  requiresFcfsClaim: boolean,
): "waitlist_email" | "waitlist_code" | "cc_manual" | "cc_manual_draw" | "cc_fcfs" | "other" {
  if (requiresFcfsClaim) return "cc_fcfs";
  switch (rewardType) {
    case "WAITLIST_EMAIL":
      return "waitlist_email";
    case "INVITE_CODE_RANDOM":
    case "INVITE_CODE":
      return "waitlist_code";
    case "CC_MANUAL":
      return "cc_manual_draw";
    case "CC_ONLY":
      return "cc_manual";
    case "INVITE_CODE_FCFS":
    case "CC_AND_INVITE":
      return "waitlist_code";
    default:
      return "other";
  }
}
