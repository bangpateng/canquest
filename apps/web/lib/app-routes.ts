import { slugify } from "@/lib/slug";

/**
 * User-facing routes — menu label matches URL path; content is swapped per product:
 *
 * - Menu **Earn** → `/earn` → partner campaigns (Quest Center)
 * - Menu **Quest** → `/quest` → CanQuest Earn hub (daily / social tasks)
 */
export const ROUTES = {
  /** Partner campaigns — open from Earn menu */
  campaignQuests: "/earn",
  campaignQuest: (questId: string, slug?: string) =>
    slug?.trim() ? `/earn/${questId}-${slugify(slug)}` : `/earn/${questId}`,
  /** CanQuest Earn hub — open from Quest menu */
  earnHub: "/quest",
  /** Rankings — below Wallet in nav */
  leaderboard: "/leaderboard",
  /** Points wheel — spend earn points for CC / bonus rewards */
  spinReward: "/spin-reward",
} as const;
