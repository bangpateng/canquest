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
