/** Canonical lowercase Canton party ID for display, QR, and send/receive. */
export function normalizeCantonPartyId(
  partyId: string | null | undefined,
): string | null {
  if (!partyId?.trim()) return null;
  const trimmed = partyId.trim();
  const sep = trimmed.indexOf("::");
  if (sep === -1) return trimmed.toLowerCase();
  const prefix = trimmed.slice(0, sep).toLowerCase();
  const suffix = trimmed.slice(sep + 2).toLowerCase();
  return `${prefix}::${suffix}`;
}

export function formatPartyIdForDisplay(partyId: string | null | undefined): string {
  return normalizeCantonPartyId(partyId) ?? "";
}

export function normalizeWalletUsername(
  username: string | null | undefined,
): string | null {
  if (!username?.trim()) return null;
  return username.trim().replace(/^@/, "").toLowerCase();
}

export function formatUsernameForDisplay(
  username: string | null | undefined,
): string {
  return normalizeWalletUsername(username) ?? "";
}

export function normalizeSendRecipientInput(raw: string): string {
  const trimmed = raw.trim().replace(/^@/, "");
  if (!trimmed) return "";
  if (trimmed.includes("::")) {
    return normalizeCantonPartyId(trimmed) ?? trimmed.toLowerCase();
  }
  return trimmed.toLowerCase();
}
