import { ForbiddenException } from '@nestjs/common';

/** True when user has a real Canton party (not a local placeholder). */
export function hasRealWallet(
  cantonPartyId: string | null | undefined,
): boolean {
  const id = cantonPartyId?.trim();
  return Boolean(id && !id.startsWith('canquest:'));
}

export const WALLET_REQUIRED_MESSAGE =
  'Please create your Canton wallet first to access Earn.';

export function assertHasRealWallet(
  cantonPartyId: string | null | undefined,
): void {
  if (!hasRealWallet(cantonPartyId)) {
    throw new ForbiddenException(WALLET_REQUIRED_MESSAGE);
  }
}
