/** Platform fee ledger rows are audit-only — excluded from user-facing history. */
export function isPlatformFeeTransaction(description: string): boolean {
  return description.startsWith('Platform fee');
}

import type { Prisma } from '@prisma/client';

export const CC_TRANSACTION_HISTORY_WHERE: Prisma.CcTransactionWhereInput = {
  NOT: {
    OR: [
      { description: { startsWith: 'Platform fee' } },
      /** Balance-sync net rows (e.g. +17 after FCFS); fee + reward lines are enough. */
      { ledgerTxId: { startsWith: 'inbound-sync:' } },
    ],
  },
};
