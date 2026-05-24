/** Normalize @handle or URL fragment to lowercase screen name (no @). */
export function normalizeTwitterUsername(raw: string): string {
  const trimmed = raw.trim().replace(/^@/, '');
  const segment = trimmed.split('/')[0]?.split('?')[0] ?? '';
  return segment.toLowerCase();
}

/** Target for twitter_follow — account to follow. */
export function parseTwitterFollowTarget(target: string | null | undefined): string | null {
  if (!target?.trim()) return null;
  const raw = target.trim();
  if (!raw.startsWith('http')) {
    const h = normalizeTwitterUsername(raw);
    return h || null;
  }
  try {
    const u = new URL(raw);
    const parts = u.pathname.split('/').filter(Boolean);
    if (!parts[0] || parts[0] === 'i') return null;
    return normalizeTwitterUsername(parts[0]);
  } catch {
    return null;
  }
}

/** Extract numeric tweet id from status URL or raw id. */
export function parseTweetIdFromTarget(target: string | null | undefined): string | null {
  if (!target?.trim()) return null;
  const raw = target.trim();
  const inline = raw.match(/status\/(\d{5,})/i);
  if (inline?.[1]) return inline[1];
  if (/^\d{5,}$/.test(raw)) return raw;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const parts = u.pathname.split('/').filter(Boolean);
    const statusIdx = parts.indexOf('status');
    if (statusIdx >= 0 && parts[statusIdx + 1] && /^\d{5,}$/.test(parts[statusIdx + 1])) {
      return parts[statusIdx + 1];
    }
  } catch {
    /* ignore */
  }
  return null;
}
