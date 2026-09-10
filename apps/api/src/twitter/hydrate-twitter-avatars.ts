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

/** Maks refresh avatar per panggilan — cegah bakar kuota sekaligus. */
const MAX_REFRESH_PER_CALL = 5;
/** Tiap N user yang butuh fetch, 1 dialihkan ke twitterapi.io (round-robin).
 *  fxtwitter gratis tapi third-party tak resmi (bisa rate-limit/down) —
 *  slot berbayar jadi katup pengaman + validasi silang. */
const PAID_EVERY_N = 20;

/** Ambil avatar: fxtwitter dulu (gratis), fallback twitterapi.io (berbayar). */
async function resolveAvatar(
  twitterApi: TwitterApiService,
  handle: string,
  forcePaid: boolean,
  logger?: Logger,
): Promise<{ url: string; userId?: string; displayName?: string } | null> {
  if (!forcePaid) {
    const fx = await fetchFxAvatar(handle);
    if (fx?.avatarUrl) {
      return {
        url: fx.avatarUrl,
        displayName: fx.displayName ?? undefined,
      };
    }
  }
  if (!twitterApi.isConfigured()) return null;
  try {
    const profile = await twitterApi.fetchUserProfile(handle);
    const url = profile.profileImageUrl?.trim();
    if (!url?.startsWith('https://')) return null;
    return {
      url,
      userId: profile.userId ?? undefined,
      displayName: profile.displayName ?? undefined,
    };
  } catch (err) {
    logger?.warn(
      `Avatar resolve failed for @${handle}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Isi avatar X yang kosong + refresh yang mati (HEAD 404 di pbs.twimg.com).
 * Strategi: fxtwitter gratis utama, tiap 20 user 1 via twitterapi.io.
 */
export async function hydrateTwitterAvatarUrls(
  prisma: PrismaService,
  twitterApi: TwitterApiService,
  users: UserAvatarRow[],
  logger?: Logger,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  // 1. Yang kosong → selalu butuh fetch.
  const missing = users.filter(
    (u) => u.twitterUsername?.trim() && !resolvePublicAvatarUrl(u),
  );

  // ESTAFET (serial, bukan paralel): satu-satu berurutan supaya tidak
  // kena rate-limit fxtwitter + urutan round-robin tiap-20 deterministik.
  // Validasi HEAD juga estafet (ringan, tapi tetap sopan ke pbs.twimg.com).
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

  let n = 0;
  for (const u of queue) {
    const handle = u.twitterUsername!.trim();
    n += 1;
    const forcePaid = n % PAID_EVERY_N === 0;
    const r = await resolveAvatar(twitterApi, handle, forcePaid, logger);
    if (!r) {
      logger?.warn(`Leaderboard avatar hydrate failed for @${handle}`);
      continue;
    }
    try {
      await prisma.user.update({
        where: { id: u.id },
        data: {
          twitterAvatarUrl: r.url,
          ...(r.userId ? { twitterUserId: r.userId } : {}),
        },
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
