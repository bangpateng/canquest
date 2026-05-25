/** True when user has a real Canton party (not a local placeholder). */
export function hasRealWallet(cantonPartyId: string | null | undefined): boolean {
  const id = cantonPartyId?.trim();
  return Boolean(id && !id.startsWith('canquest:'));
}
