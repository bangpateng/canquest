import { slugify } from "@/lib/routing/slug";

/**
 * User-facing routes — menu label matches URL path; content is swapped per product:
 *
 * - Menu **Earn** → `/earn` → partner campaigns (Quest Center)
 * - Menu **Quest** → `/quests` → CanQuest Quest hub (daily / social tasks)
 */
export const ROUTES = {
  /** Ecosystem partner directory — open from Ecosystem menu */
  ecosystem: "/ecosystem",
  /** Partner campaigns — open from Earn menu */
  campaignQuests: "/earn",
  campaignQuest: (questId: string, slug?: string) =>
    slug?.trim() ? `/earn/${questId}-${slugify(slug)}` : `/earn/${questId}`,
  /** CanQuest Quest hub — open from Quest menu. NOTE: path stays `/quests`;
      the backend API route is still `/quests/earn-hub` (historical, kept). */
  questHub: "/quests",
  /** Rankings — below Wallet in nav */
  leaderboard: "/leaderboard",
} as const;
