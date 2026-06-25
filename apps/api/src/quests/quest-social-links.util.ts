export const QUEST_SOCIAL_PLATFORMS = [
  'twitter',
  'discord',
  'telegram',
  'website',
  'github',
  'youtube',
  'linkedin',
  'instagram',
  'medium',
] as const;

export type QuestSocialPlatform = (typeof QUEST_SOCIAL_PLATFORMS)[number];

export interface QuestSocialLink {
  platform: QuestSocialPlatform;
  url: string;
}

/** Raw payload from admin HTTP API before validation. */
export type QuestSocialLinkInput = {
  platform: string;
  url: string;
};

const PLATFORM_SET = new Set<string>(QUEST_SOCIAL_PLATFORMS);

function isPlatform(v: string): v is QuestSocialPlatform {
  return PLATFORM_SET.has(v);
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function parseQuestSocialLinks(
  raw: string | null | undefined,
): QuestSocialLink[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: QuestSocialLink[] = [];
    const seen = new Set<QuestSocialPlatform>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const platform = String((item as { platform?: string }).platform ?? '');
      const url = normalizeUrl(String((item as { url?: string }).url ?? ''));
      if (!isPlatform(platform) || !url || seen.has(platform)) continue;
      seen.add(platform);
      out.push({ platform, url });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeQuestSocialLinks(links: QuestSocialLink[]): string {
  return JSON.stringify(links);
}

/** Validate and dedupe links from admin API payloads. */
export function normalizeQuestSocialLinksForSave(
  links: unknown,
): QuestSocialLink[] {
  if (!Array.isArray(links)) return [];
  const out: QuestSocialLink[] = [];
  const seen = new Set<QuestSocialPlatform>();
  for (const item of links) {
    if (!item || typeof item !== 'object') continue;
    const platform = String((item as { platform?: string }).platform ?? '');
    const url = normalizeUrl(String((item as { url?: string }).url ?? ''));
    if (!isPlatform(platform) || !url || seen.has(platform)) continue;
    seen.add(platform);
    out.push({ platform, url });
  }
  return out;
}
