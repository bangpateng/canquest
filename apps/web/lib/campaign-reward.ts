import type { Quest, QuestRewardState, QuestRewardStatus, RewardType } from "@/lib/quest-types";

export type CampaignMeta = {
  ended: boolean;
  endsAt: string | null;
  remainingSlots: number | null;
  maxWinners: number | null;
  fcfsClaimFeeCc: number;
  requiresFcfsClaim: boolean;
  requiresPaidInviteClaim?: boolean;
  codesRemaining?: number | null;
};

/** Earn list cards — mirrors API `campaignSummary` on GET /quests */
export type QuestCampaignSummary = {
  requiresFcfsClaim: boolean;
  requiresPaidInviteClaim: boolean;
  maxWinners: number | null;
  remainingSlots: number | null;
  fcfsClaimFeeCc: number;
  poolTotalCc: number | null;
  codesRemaining: number | null;
};

export function formatPoolTotalLabel(poolTotalCc: number | null, rewardPool: string): string {
  if (poolTotalCc != null && poolTotalCc > 0) return `${poolTotalCc} CC`;
  return rewardPool.trim() || "—";
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

/** e.g. "2/3 Remaining" — slots left / max FCFS winners */
export function formatFcfsSlotsRemaining(
  remaining: number,
  maxWinners: number | null | undefined,
): string {
  const max = maxWinners ?? 0;
  if (max <= 0) return "—";
  const left = Math.max(0, Math.min(remaining, max));
  return `${left}/${max} Remaining`;
}

export function formatFcfsClaimFeeHint(feeCc: number, rewardCc: number): string {
  return `Pay ${feeCc} CC claim fee on-chain to receive ${rewardCc} CC from the pool`;
}

export function campaignUiKind(
  rewardType: RewardType | string | undefined,
  requiresFcfsClaim: boolean,
): "waitlist_email" | "waitlist_code" | "cc_manual" | "cc_fcfs" | "other" {
  if (requiresFcfsClaim) return "cc_fcfs";
  switch (rewardType) {
    case "WAITLIST_EMAIL":
      return "waitlist_email";
    case "INVITE_CODE_RANDOM":
    case "INVITE_CODE":
      return "waitlist_code";
    case "CC_ONLY":
      return "cc_manual";
    case "INVITE_CODE_FCFS":
    case "CC_AND_INVITE":
      return "waitlist_code";
    default:
      return "other";
  }
}
