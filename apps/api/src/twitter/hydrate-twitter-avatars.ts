import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { resolvePublicAvatarUrl } from '../users/user-avatar-url';
import type { TwitterApiService } from './twitter-api.service';

type UserAvatarRow = {
  id: string;
  twitterUsername: string | null;
  twitterAvatarUrl?: string | null;
};

/** Fetch missing X profile photos via twitterapi.io and persist for leaderboard. */
export async function hydrateTwitterAvatarUrls(
  prisma: PrismaService,
  twitterApi: TwitterApiService,
  users: UserAvatarRow[],
  logger?: Logger,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (!twitterApi.isConfigured()) return resolved;

  const missing = users.filter(
    (u) => u.twitterUsername?.trim() && !resolvePublicAvatarUrl(u),
  );
  if (missing.length === 0) return resolved;

  await Promise.all(
    missing.map(async (u) => {
      const handle = u.twitterUsername!.trim();
      try {
        const profile = await twitterApi.fetchUserProfile(handle);
        const url = profile.profileImageUrl?.trim();
        if (!url?.startsWith('https://')) return;

        await prisma.user.update({
          where: { id: u.id },
          data: {
            twitterAvatarUrl: url,
            ...(profile.userId ? { twitterUserId: profile.userId } : {}),
          },
        });
        resolved.set(u.id, url);
      } catch (err) {
        logger?.warn(
          `Leaderboard avatar hydrate failed for @${handle}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  return resolved;
}
