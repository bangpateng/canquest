/**
 * Fetch avatar X via fxtwitter (FixTweet) — gratis, tanpa API key.
 * Response: { code, user: { avatar_url, name, screen_name } }.
 * Gagal / rate-limit / timeout → null (caller fallback ke twitterapi.io).
 */
export type FxProfile = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export async function fetchFxAvatar(
  username: string,
  timeoutMs = 10_000,
): Promise<FxProfile | null> {
  const handle = username.trim().replace(/^@/, '');
  if (!handle) return null;
  try {
    const res = await fetch(
      `https://api.fxtwitter.com/${encodeURIComponent(handle)}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      code?: number;
      user?: {
        screen_name?: string;
        name?: string;
        avatar_url?: string;
      };
    } | null;
    if (!body || body.code !== 200 || !body.user) return null;
    const avatarUrl =
      typeof body.user.avatar_url === 'string' &&
      body.user.avatar_url.startsWith('https://')
        ? body.user.avatar_url
        : null;
    return {
      username:
        typeof body.user.screen_name === 'string' && body.user.screen_name
          ? body.user.screen_name
          : handle,
      displayName:
        typeof body.user.name === 'string' && body.user.name
          ? body.user.name
          : null,
      avatarUrl,
    };
  } catch {
    return null;
  }
}

/** HEAD murah ke pbs.twimg.com: true bila URL masih hidup (bukan 404). */
export async function isAvatarUrlAlive(
  url: string,
  timeoutMs = 8_000,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
