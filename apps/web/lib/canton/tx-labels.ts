/**
 * Shared tipe transaksi + label map (dipakai transactions-view & transaction-detail).
 *
 * Sebelumnya TX_TYPE_KEYS hidup hanya di transactions-view.tsx sehingga detail
 * transaksi menampilkan label mentah ("TRANSFER_IN" → "TRANSFER IN"). Dipindah ke
 * sini supaya detail content juga bisa pakai label ramah yang sama
 * ("Received CC", "Sent CC", "CC Locked", …) tanpa duplikasi konstanta.
 */

/** Union semua tipe transaksi (CC + token non-CC). */
export type TxType =
  | "QUEST_REWARD"
  | "SPIN_REWARD"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "AIRDROP"
  | "CC_LOCK"
  | "CC_UNLOCK"
  | "OFFER_REJECTED"
  | "OFFER_WITHDRAWN"
  | "PREAPPROVAL_ENABLED"
  | "PREAPPROVAL_DISABLED"
  | "SWAP_OUT"
  | "SWAP_IN"
  | "TOKEN_TRANSFER_IN"
  | "TOKEN_TRANSFER_OUT"
  | "TOKEN_OFFER_REJECTED"
  | "TOKEN_OFFER_WITHDRAWN";

/** Map tipe → i18n key (untuk usePlatformT). */
export const TX_TYPE_KEYS: Record<TxType, string> = {
  QUEST_REWARD: "transactions.questReward",
  SPIN_REWARD: "transactions.spinReward",
  TRANSFER_IN: "transactions.receivedCc",
  TRANSFER_OUT: "transactions.sentCc",
  AIRDROP: "transactions.airdrop",
  CC_LOCK: "transactions.ccLocked",
  CC_UNLOCK: "transactions.ccUnlocked",
  OFFER_REJECTED: "transactions.offerRejected",
  OFFER_WITHDRAWN: "transactions.offerWithdrawn",
  PREAPPROVAL_ENABLED: "transactions.preapprovalEnabled",
  PREAPPROVAL_DISABLED: "transactions.preapprovalDisabled",
  SWAP_OUT: "transactions.swapOut",
  SWAP_IN: "transactions.swapIn",
  TOKEN_TRANSFER_IN: "transactions.tokenReceived",
  TOKEN_TRANSFER_OUT: "transactions.tokenSent",
  TOKEN_OFFER_REJECTED: "transactions.tokenOfferRejected",
  TOKEN_OFFER_WITHDRAWN: "transactions.tokenOfferWithdrawn",
};

/** Fallback label English (kalau t() tidak tersedia / tipe tak dikenal). */
export const TX_TYPE_FALLBACK: Record<TxType, string> = {
  QUEST_REWARD: "Earn reward",
  SPIN_REWARD: "Spin reward",
  TRANSFER_IN: "Received CC",
  TRANSFER_OUT: "Sent CC",
  AIRDROP: "Airdrop",
  CC_LOCK: "CC Locked",
  CC_UNLOCK: "CC Unlocked",
  OFFER_REJECTED: "Rejected",
  OFFER_WITHDRAWN: "Cancelled",
  PREAPPROVAL_ENABLED: "Preapproval enabled",
  PREAPPROVAL_DISABLED: "Preapproval disabled",
  SWAP_OUT: "Swap (CC out)",
  SWAP_IN: "Swap (CC in)",
  TOKEN_TRANSFER_IN: "Token received",
  TOKEN_TRANSFER_OUT: "Token sent",
  TOKEN_OFFER_REJECTED: "Rejected",
  TOKEN_OFFER_WITHDRAWN: "Cancelled",
};

/**
 * Label ramah untuk tipe transaksi. Pakai i18n key bila t tersedia, else fallback.
 * Aman untuk tipe tak dikenal → kembalikan type.replace(/_/g," ") (behavior lama).
 */
export function txTypeLabel(
  type: string,
  t?: (key: string) => string,
): string {
  const known = TX_TYPE_KEYS[type as TxType];
  if (!known) return type.replace(/_/g, " ");
  if (t) return t(known);
  return TX_TYPE_FALLBACK[type as TxType] ?? type.replace(/_/g, " ");
}
