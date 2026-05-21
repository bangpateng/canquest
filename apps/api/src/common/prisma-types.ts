/**
 * String literal types menggantikan Prisma enum imports.
 * Dibuat karena npm workspaces meng-hoist @prisma/client ke root node_modules
 * sehingga enum tidak selalu tersedia saat kompilasi di sub-package.
 * Nilai ini harus sinkron dengan prisma/schema.prisma.
 */

export type QuestStatus = 'ACTIVE' | 'COMPLETED' | 'DRAFT' | 'ARCHIVED';
export const QuestStatus = {
  ACTIVE: 'ACTIVE' as QuestStatus,
  COMPLETED: 'COMPLETED' as QuestStatus,
  DRAFT: 'DRAFT' as QuestStatus,
  ARCHIVED: 'ARCHIVED' as QuestStatus,
};

export type RewardType = 'CC_ONLY' | 'INVITE_CODE' | 'CC_AND_INVITE' | 'NONE';
export const RewardType = {
  CC_ONLY: 'CC_ONLY' as RewardType,
  INVITE_CODE: 'INVITE_CODE' as RewardType,
  CC_AND_INVITE: 'CC_AND_INVITE' as RewardType,
  NONE: 'NONE' as RewardType,
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
