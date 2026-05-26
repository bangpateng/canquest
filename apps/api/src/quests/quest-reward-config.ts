import { RewardType, normalizeRewardType } from '../common/prisma-types';

/** Default platform claim fee (CC) when quest.claimFeeCc is null. */
export function defaultClaimFeeCc(rewardType: RewardType | string): number | null {
  const rt = normalizeRewardType(rewardType as RewardType);
  switch (rt) {
    case RewardType.INVITE_CODE_FCFS:
    case RewardType.INVITE_CODE_RANDOM:
    case RewardType.INVITE_CODE:
    case RewardType.CC_AND_INVITE:
      return 2;
    case RewardType.CC_ONLY:
      return 3;
    default:
      return null;
  }
}

export function resolveClaimFeeCc(quest: {
  claimFeeCc?: number | null;
  rewardType: RewardType | string;
}): number | null {
  if (quest.claimFeeCc != null && quest.claimFeeCc >= 0) {
    return quest.claimFeeCc > 0 ? quest.claimFeeCc : null;
  }
  return defaultClaimFeeCc(quest.rewardType);
}

/** e.g. "2/3 Remaining" — FCFS slots left / max winners */
export function formatFcfsSlotsRemainingLabel(
  remaining: number,
  maxWinners: number,
): string {
  const max = Math.max(1, maxWinners);
  const left = Math.max(0, Math.min(remaining, max));
  return `${left}/${max} Remaining`;
}

export function formatFcfsClaimFeeHint(feeCc: number, rewardCc: number): string {
  return `Pay ${feeCc} CC claim fee on-chain to receive ${rewardCc} CC from the pool`;
}

/** Total CC allocated when each winner receives rewardCc (FCFS cap × per-winner reward). */
export function computePoolTotalCc(
  rewardCc: number,
  maxWinners: number | null | undefined,
): number | null {
  if (rewardCc <= 0 || maxWinners == null || maxWinners < 1) return null;
  return maxWinners * rewardCc;
}

export type QuestCampaignSummary = {
  requiresFcfsClaim: boolean;
  requiresPaidInviteClaim: boolean;
  maxWinners: number | null;
  remainingSlots: number | null;
  fcfsClaimFeeCc: number;
  poolTotalCc: number | null;
  codesRemaining: number | null;
};

/** Invite / code rewards that require on-chain fee before revealing the code. */
export function requiresPaidInviteClaim(quest: {
  claimFeeCc?: number | null;
  rewardType: RewardType | string;
}): boolean {
  const fee = resolveClaimFeeCc(quest);
  if (fee == null || fee <= 0) return false;
  const rt = normalizeRewardType(quest.rewardType as RewardType);
  return (
    rt === RewardType.INVITE_CODE_FCFS ||
    rt === RewardType.INVITE_CODE_RANDOM ||
    rt === RewardType.INVITE_CODE
  );
}
