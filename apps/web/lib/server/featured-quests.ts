import { internalApiBase } from "@/lib/internal-api-url";
import {
  formatQuestDeadlineDisplay,
  type Quest,
} from "@/lib/quest-types";

function normalizeQuest(raw: Quest): Quest {
  return {
    ...raw,
    deadline:
      raw.deadline ??
      formatQuestDeadlineDisplay(raw.endsAt) ??
      null,
  };
}

/** Live quests for landing — public Nest route, revalidates every 30s. */
export async function fetchFeaturedQuests(limit = 20): Promise<Quest[]> {
  try {
    const res = await fetch(
      `${internalApiBase()}/public/quests?limit=${limit}`,
      { next: { revalidate: 30 } },
    );
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((q) => normalizeQuest(q as Quest));
  } catch {
    return [];
  }
}
