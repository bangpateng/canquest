/**
 * Canton party IDs are compared and stored in a canonical lowercase form so
 * transfers work whether the user types AZ1Z1M::… or az1z1m::….
 */
export function normalizeCantonPartyId(
  partyId: string | null | undefined,
): string | null {
  if (!partyId?.trim()) return null;
  const trimmed = partyId.trim();
  const sep = trimmed.indexOf('::');
  if (sep === -1) return trimmed.toLowerCase();
  const prefix = trimmed.slice(0, sep).toLowerCase();
  const suffix = trimmed.slice(sep + 2).toLowerCase();
  return `${prefix}::${suffix}`;
}

export function cantonPartyIdsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeCantonPartyId(a);
  const nb = normalizeCantonPartyId(b);
  return !!na && !!nb && na === nb;
}

export function looksLikeCantonPartyId(value: string): boolean {
  return value.includes('::');
}

/** Wallet / Canton login name — always stored and displayed lowercase. */
export function normalizeWalletUsername(
  username: string | null | undefined,
): string | null {
  if (!username?.trim()) return null;
  return username.trim().replace(/^@/, '').toLowerCase();
}

/**
 * Splice wallet JWT `sub` matches the party hint (prefix before `::`).
 * Use this when DB username may differ from the name used at wallet onboarding.
 */
export function spliceWalletUsernameFromParty(
  partyId: string | null | undefined,
): string | null {
  const normalized = normalizeCantonPartyId(partyId);
  if (!normalized) return null;
  const sep = normalized.indexOf('::');
  if (sep <= 0) return null;
  return normalized.slice(0, sep);
}
