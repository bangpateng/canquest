const DEFAULT_API_ORIGIN = "https://api.canquest.cc";

/** Ensure quest banner/logo URLs load from the API proxy (cross-origin safe). */
export function resolveQuestMediaUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();

  const match = trimmed.match(/\/quests\/([0-9a-f-]{36}\.[a-z0-9]+)/i);
  if (match) {
    const base =
      process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "") ?? DEFAULT_API_ORIGIN;
    return `${base}/api/uploads/quests/${match[1]}`;
  }

  return trimmed;
}
