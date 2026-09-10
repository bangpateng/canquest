import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { resolvePublicAvatarUrl } from '../users/user-avatar-url';
import type { TwitterApiService } from './twitter-api.service';
import { fetchFxAvatar, isAvatarUrlAlive } from './twitter-fx.service';

type UserAvatarRow = {
  id: string;
  twitterUsername: string | null;
  twitterAvatarUrl?: string | null;
};

/** Maks refresh avatar per panggilan — cegah spam request sekaligus. */
const MAX_REFRESH_PER_CALL = 5;

/** Ambil avatar: fxtwitter SAJA (gratis, tanpa key). Gagal → null, coba
 *  lagi di load berikutnya. Tidak ada jalur berbayar. */
async function resolveAvatar(
  handle: string,
): Promise<{ url: string } | null> {
  const fx = await fetchFxAvatar(handle);
  if (fx?.avatarUrl) return { url: fx.avatarUrl };
  return null;
}

/**
 * Isi avatar X yang kosong + refresh yang mati (HEAD 404 di pbs.twimg.com).
 * Sumber: fxtwitter SAJA (gratis, tanpa key, tanpa jalur berbayar).
 */
export async function hydrateTwitterAvatarUrls(
  prisma: PrismaService,
  _twitterApi: TwitterApiService,
  users: UserAvatarRow[],
  logger?: Logger,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  // 1. Yang kosong → selalu butuh fetch.
  const missing = users.filter(
    (u) => u.twitterUsername?.trim() && !resolvePublicAvatarUrl(u),
  );

  // ESTAFET (serial, bukan paralel): satu-satu berurutan supaya tidak
  // kena rate-limit fxtwitter. Validasi HEAD juga estafet (ringan, tapi
  // tetap sopan ke pbs.twimg.com).
  const withUrl = users.filter(
    (u) => u.twitterUsername?.trim() && resolvePublicAvatarUrl(u),
  );
  const stale: UserAvatarRow[] = [];
  for (const u of withUrl) {
    const url = resolvePublicAvatarUrl(u);
    if (!url) continue;
    const alive = await isAvatarUrlAlive(url);
    if (!alive) stale.push(u);
    if (stale.length >= MAX_REFRESH_PER_CALL) break;
  }

  const queue = [...missing, ...stale].slice(0, MAX_REFRESH_PER_CALL);
  if (queue.length === 0) return resolved;

  for (const u of queue) {
    const handle = u.twitterUsername!.trim();
    const r = await resolveAvatar(handle);
    if (!r) {
      logger?.warn(`Leaderboard avatar hydrate failed for @${handle}`);
      continue;
    }
    try {
      await prisma.user.update({
        where: { id: u.id },
        data: { twitterAvatarUrl: r.url },
      });
      resolved.set(u.id, r.url);
    } catch (err) {
      logger?.warn(
        `Leaderboard avatar persist failed for @${handle}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return resolved;
}
