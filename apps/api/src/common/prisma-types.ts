/**
 * String literal types — must match prisma/schema.prisma enums exactly.
 * Used instead of @prisma/client enum imports for reliable builds in npm workspaces.
 */

export type QuestKind = 'CAMPAIGN' | 'EARN_HUB';
export const QuestKind = {
  CAMPAIGN: 'CAMPAIGN' as QuestKind,
  EARN_HUB: 'EARN_HUB' as QuestKind,
};

export type QuestStatus = 'ACTIVE' | 'COMING_SOON' | 'ENDED';
export const QuestStatus = {
  ACTIVE: 'ACTIVE' as QuestStatus,
  COMING_SOON: 'COMING_SOON' as QuestStatus,
  ENDED: 'ENDED' as QuestStatus,
};

/** User-facing tab status from DB status + schedule (startsAt / endsAt). */
export function resolveQuestDisplayStatus(
  q: {
    status: QuestStatus;
    startsAt?: Date | string | null;
    endsAt?: Date | string | null;
    /** Legacy/admin-friendly date label; may be parseable as a real date. */
    deadline?: string | null;
  },
  now = new Date(),
): QuestStatus {
  const startsAt = q.startsAt ? new Date(q.startsAt) : null;
  const endsAt = q.endsAt ? new Date(q.endsAt) : null;
  const deadline =
    !endsAt && q.deadline?.trim()
      ? new Date(q.deadline)
      : null;
  const hasDeadline = Boolean(deadline && Number.isFinite(deadline.getTime()));

  if (endsAt && endsAt < now) return QuestStatus.ENDED;
  if (!endsAt && hasDeadline && deadline! < now) return QuestStatus.ENDED;
  if (startsAt && startsAt > now) return QuestStatus.COMING_SOON;
  if (q.status === QuestStatus.ENDED) return QuestStatus.ENDED;
  if (q.status === QuestStatus.COMING_SOON) return QuestStatus.COMING_SOON;
  return QuestStatus.ACTIVE;
}

export type RewardType =
  | 'WAITLIST_EMAIL'
  | 'INVITE_CODE_RANDOM'
  | 'INVITE_CODE_FCFS'
  | 'CC_ONLY'
  | 'CC_AND_INVITE'
  | 'INVITE_CODE';
export const RewardType = {
  WAITLIST_EMAIL: 'WAITLIST_EMAIL' as RewardType,
  INVITE_CODE_RANDOM: 'INVITE_CODE_RANDOM' as RewardType,
  INVITE_CODE_FCFS: 'INVITE_CODE_FCFS' as RewardType,
  CC_ONLY: 'CC_ONLY' as RewardType,
  CC_AND_INVITE: 'CC_AND_INVITE' as RewardType,
  INVITE_CODE: 'INVITE_CODE' as RewardType,
};

/** Normalize legacy INVITE_CODE → random draw category */
export function normalizeRewardType(rt: RewardType): RewardType {
  return rt === 'INVITE_CODE' ? 'INVITE_CODE_RANDOM' : rt;
}

export type SubmissionStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export const SubmissionStatus = {
  PENDING: 'PENDING' as SubmissionStatus,
  VERIFIED: 'VERIFIED' as SubmissionStatus,
  REJECTED: 'REJECTED' as SubmissionStatus,
};

export type CcTransactionType =
  | 'QUEST_REWARD'
  | 'SPIN_REWARD'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'AIRDROP';
