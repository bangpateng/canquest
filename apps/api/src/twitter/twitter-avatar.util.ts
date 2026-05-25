/** ~48×48 Twitter CDN avatar — keeps leaderboard light. */
export function normalizeTwitterAvatarUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  let trimmed = url.trim().replace(/^http:\/\//i, 'https://');
  if (!trimmed.includes('twimg.com')) return trimmed;

  if (/_normal(\.(jpe?g|png|webp))?$/i.test(trimmed)) {
    return trimmed;
  }

  if (/_400x400|_bigger/i.test(trimmed)) {
    return trimmed.replace(/_400x400|_bigger/i, '_normal');
  }

  return trimmed.replace(/(\.(jpe?g|png|webp))$/i, '_normal$1');
}

export function pickTwitterProfileImage(data: Record<string, unknown>): string | null {
  const nested =
    data.user && typeof data.user === 'object'
      ? (data.user as Record<string, unknown>)
      : data;
  const candidates = [
    nested.profilePicture,
    nested.profile_image_url_https,
    nested.profile_image_url,
    nested.profileImageUrl,
    nested.avatar,
    nested.profilePic,
    data.profilePicture,
    data.profile_image_url_https,
    data.profile_image_url,
  ];
  for (const raw of candidates) {
    if (typeof raw === 'string' && raw.trim()) {
      return normalizeTwitterAvatarUrl(raw);
    }
  }
  return null;
}

export function pickTwitterDisplayName(data: Record<string, unknown>): string | null {
  const nested =
    data.user && typeof data.user === 'object'
      ? (data.user as Record<string, unknown>)
      : data;
  const raw = nested.name ?? nested.displayName ?? data.name;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim().slice(0, 80);
}
