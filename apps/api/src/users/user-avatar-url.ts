/** Leaderboard / profile photo from linked X only (no VPS upload). */
export function resolvePublicAvatarUrl(user: {
  twitterAvatarUrl?: string | null;
}): string | null {
  const tw = user.twitterAvatarUrl?.trim();
  if (tw?.startsWith('https://')) return tw;
  return null;
}
