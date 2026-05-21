/**
 * String literal types — must match prisma/schema.prisma enums exactly.
 * Used instead of @prisma/client enum imports for reliable builds in npm workspaces.
 */

export type QuestStatus = 'ACTIVE' | 'COMING_SOON' | 'ENDED';
export const QuestStatus = {
  ACTIVE: 'ACTIVE' as QuestStatus,
  COMING_SOON: 'COMING_SOON' as QuestStatus,
  ENDED: 'ENDED' as QuestStatus,
};

export type RewardType = 'CC_ONLY' | 'INVITE_CODE' | 'CC_AND_INVITE';
export const RewardType = {
  CC_ONLY: 'CC_ONLY' as RewardType,
  INVITE_CODE: 'INVITE_CODE' as RewardType,
  CC_AND_INVITE: 'CC_AND_INVITE' as RewardType,
};

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
