import type { Quest, QuestRewardState, QuestRewardStatus, RewardType } from "@/lib/quest-types";

export type CampaignMeta = {
  ended: boolean;
  endsAt: string | null;
  remainingSlots: number | null;
  maxWinners: number | null;
  fcfsClaimFeeCc: number;
  requiresFcfsClaim: boolean;
};

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
