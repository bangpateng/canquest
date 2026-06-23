/** Platform fee ledger rows are audit-only — excluded from user-facing history. */
export function isPlatformFeeTransaction(description: string): boolean {
  return description.startsWith('Platform fee');
}

import type { Prisma } from '@prisma/client';

/**
 * Filter terpusat — dipakai getTransactions & notifikasi.
 *
 * HANYA menyembunyikan baris fee (audit-only), BUKAN transfer normal. Fee ditandai dua cara:
 *   1. referenceId prefix "fee:" — marker eksplisit yang ditulis saat fee row dibuat (A3).
 *   2. description prefix "Platform fee" — backward-compat untuk baris lama yang sudah ada.
 *
 * Baris transfer normal TIDAK terkena kondisi ini: mereka tidak bermarker "fee:" dan
 * deskripsinya tidak diawali "Platform fee".
 */
export const CC_TRANSACTION_HISTORY_WHERE: Prisma.CcTransactionWhereInput = {
  NOT: {
    OR: [
      /** Fee marker (A3) — penanda tahan banting yang ditulis di party.controller.ts. */
      { referenceId: { startsWith: 'fee:' } },
      /** Legacy fee rows: deskripsi diawali "Platform fee". */
      { description: { startsWith: 'Platform fee' } },
      /** Balance-sync net rows (e.g. +17 after FCFS); fee + reward lines are enough. */
      { ledgerTxId: { startsWith: 'inbound-sync:' } },
    ],
  },
};
