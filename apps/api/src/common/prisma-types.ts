/**
 * String literal types — must match prisma/schema.prisma enums exactly.
 * Used instead of @prisma/client enum imports for reliable builds in npm workspaces.
 */

export type QuestKind = 'CAMPAIGN' | 'EARN_HUB';
export const QuestKind = {
  CAMPAIGN: 'CAMPAIGN' as QuestKind,
  EARN_HUB: 'EARN_HUB' as QuestKind,
};

/**
 * Mode gate akses Earn per-campaign (di-set admin per-event).
 * CC_OR_POINTS = lock CC ATAU spend points (default, perilaku lama).
 * CC_ONLY = hanya lock CC. POINTS_ONLY = hanya spend points. NONE = tanpa gate (event gratis).
 */
export type EntryGateMode = 'CC_OR_POINTS' | 'CC_ONLY' | 'POINTS_ONLY' | 'NONE';
export const EntryGateMode = {
  CC_OR_POINTS: 'CC_OR_POINTS' as EntryGateMode,
  CC_ONLY: 'CC_ONLY' as EntryGateMode,
  POINTS_ONLY: 'POINTS_ONLY' as EntryGateMode,
  NONE: 'NONE' as EntryGateMode,
};
export const ENTRY_GATE_MODES: EntryGateMode[] = [
  'CC_OR_POINTS',
  'CC_ONLY',
  'POINTS_ONLY',
  'NONE',
];
export function normalizeEntryGateMode(
  m: string | null | undefined,
): EntryGateMode {
  return ENTRY_GATE_MODES.includes(m as EntryGateMode)
    ? (m as EntryGateMode)
    : EntryGateMode.CC_OR_POINTS;
}

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
  const deadline = !endsAt && q.deadline?.trim() ? new Date(q.deadline) : null;
  const hasDeadline = Boolean(deadline && Number.isFinite(deadline.getTime()));

  if (endsAt && endsAt < now) return QuestStatus.ENDED;
  if (hasDeadline && deadline! < now) return QuestStatus.ENDED;
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
  | 'CC_MANUAL'
  | 'CC_AND_INVITE'
  | 'CC_AND_CODE_RAFFLE'
  | 'INVITE_CODE';
export const RewardType = {
  WAITLIST_EMAIL: 'WAITLIST_EMAIL' as RewardType,
  INVITE_CODE_RANDOM: 'INVITE_CODE_RANDOM' as RewardType,
  INVITE_CODE_FCFS: 'INVITE_CODE_FCFS' as RewardType,
  CC_ONLY: 'CC_ONLY' as RewardType,
  CC_MANUAL: 'CC_MANUAL' as RewardType,
  CC_AND_INVITE: 'CC_AND_INVITE' as RewardType,
  CC_AND_CODE_RAFFLE: 'CC_AND_CODE_RAFFLE' as RewardType,
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
  | 'AIRDROP'
  | 'CC_LOCK'
  | 'CC_UNLOCK'
  /// Receiver menolak incoming TransferInstruction (onchain exercise).
  | 'OFFER_REJECTED'
  /// Sender menarik kembali TransferInstruction yang belum di-accept.
  | 'OFFER_WITHDRAWN'
  /// User mengaktifkan TransferPreapproval (onchain create, burn fee).
  | 'PREAPPROVAL_ENABLED'
  /// User menonaktifkan TransferPreapproval (onchain archive).
  | 'PREAPPROVAL_DISABLED'
  /// CC keluar ke Cantex trading account (swap CC → token).
  | 'SWAP_OUT'
  /// CC masuk dari Cantex trading account (swap token → CC).
  | 'SWAP_IN';

/**
 * Tipe event P2P token transfer non-CC on-chain (CIP-0056 two-step).
 * Harus match enum `TokenTxType` di prisma/schema.prisma persis.
 */
export type TokenTxType =
  /// Sender mengirim token (offer dibuat di on-chain).
  | 'TOKEN_TRANSFER_OUT'
  /// Receiver menerima token setelah accept TransferInstruction.
  | 'TOKEN_TRANSFER_IN'
  /// Offer dibuat, menunggu accept (intermediate state, opsional).
  | 'TOKEN_OFFER_PENDING'
  /// Receiver menolak TransferInstruction (token kembali ke sender).
  | 'TOKEN_OFFER_REJECTED'
  /// Sender menarik kembali TransferInstruction yang belum di-accept.
  | 'TOKEN_OFFER_WITHDRAWN'
  /// Fee CC keluar untuk P2P token transfer (fee in CC, reuse TRANSACTION_FEE_CC).
  | 'TOKEN_FEE_OUT';

/** TokenTxType yang merepresentasikan keluarnya token/CC dari user (debit). */
export const TOKEN_TX_DEBIT_TYPES: ReadonlySet<TokenTxType> =
  new Set<TokenTxType>(['TOKEN_TRANSFER_OUT', 'TOKEN_FEE_OUT']);

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';
export const UserStatus = {
  ACTIVE: 'ACTIVE' as UserStatus,
  SUSPENDED: 'SUSPENDED' as UserStatus,
  BANNED: 'BANNED' as UserStatus,
};

/** CcTransactionTypes that represent a lock/unlock (no counterparty; CC stays in user's party). */
export const CC_LOCK_TYPES: ReadonlySet<CcTransactionType> =
  new Set<CcTransactionType>(['CC_LOCK', 'CC_UNLOCK']);
