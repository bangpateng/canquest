/**
 * Pesan error/sukses bersama untuk semua claim card.
 * Sebelumnya tiap file claim mendeklarasikan konstanta sendiri yang nyaris identik
 * (FCFS_FAIL_MSG, CLAIM_FAIL_MSG) — disatukan di sini supaya konsisten.
 */

/** Claim gagal karena transaksi on-chain revert / saldo kurang / network. */
export const CLAIM_FAIL_MSG =
  "Claim failed: Transaction reverted by ledger (insufficient balance or network error)";

/** Varian khusus FCFS: slot bisa penuh. */
export const FCFS_CLAIM_FAIL_MSG =
  "Claim failed: Transaction reverted by ledger (slot is full or insufficient balance)";
