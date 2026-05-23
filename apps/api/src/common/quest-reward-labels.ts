/** Parse quest id from legacy CC transaction descriptions. */
export function parseQuestIdFromRewardDescription(description: string): string | null {
  const trimmed = description.trim();
  const patterns = [
    /^Quest\s+winner\s+reward:\s*(.+)$/i,
    /^Quest\s+reward:\s*(.+)$/i,
    /^Winner\s+reward:\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  if (looksLikeQuestId(trimmed)) return trimmed;
  return null;
}

/** Heuristic: internal quest id (cuid / custom id), not human-readable copy. */
export function looksLikeQuestId(value: string): boolean {
  const v = value.trim();
  if (!v || v.includes(' ') || v.length < 12) return false;
  if (v.startsWith('@') || v.startsWith('Validator')) return false;
  return /^[a-z0-9_-]+$/i.test(v);
}

export function isLegacyQuestRewardDescription(description: string): boolean {
  return parseQuestIdFromRewardDescription(description) !== null;
}
