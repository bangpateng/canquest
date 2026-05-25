/** Platform fee ledger rows are audit-only — excluded from user-facing history. */
export function isPlatformFeeTransaction(description: string): boolean {
  return description.startsWith('Platform fee');
}

export const CC_TRANSACTION_HISTORY_WHERE = {
  NOT: { description: { startsWith: 'Platform fee' } },
} as const;
