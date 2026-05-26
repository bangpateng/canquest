import type { R2StorageService } from './r2-storage.service';

export type QuestMediaFields = {
  bannerImageUrl?: string | null;
  logoUrl?: string | null;
};

/** Rewrite stored R2 / local quest asset URLs to the API proxy path browsers can load. */
export function withQuestMediaUrls<T extends QuestMediaFields>(
  quest: T,
  storage: R2StorageService,
): T {
  return {
    ...quest,
    bannerImageUrl: storage.normalizeQuestMediaUrl(quest.bannerImageUrl),
    logoUrl: storage.normalizeQuestMediaUrl(quest.logoUrl),
  };
}
