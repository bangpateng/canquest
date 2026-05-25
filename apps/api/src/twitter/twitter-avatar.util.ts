/** Upgrade Twitter CDN avatar from thumb (_normal) to 400×400 for sharp UI. */
export function upgradeTwitterAvatarUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (!trimmed.includes('pbs.twimg.com')) return trimmed;
  return trimmed.replace(/_normal(\.(jpe?g|png|webp))?$/i, '_400x400$1');
}

export function pickTwitterProfileImage(data: Record<string, unknown>): string | null {
  const nested =
    data.user && typeof data.user === 'object'
      ? (data.user as Record<string, unknown>)
      : data;
  const raw =
    nested.profilePicture ??
    nested.profile_image_url ??
    nested.profile_image_url_https ??
    nested.avatar ??
    data.profilePicture ??
    data.profile_image_url;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return upgradeTwitterAvatarUrl(raw);
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
