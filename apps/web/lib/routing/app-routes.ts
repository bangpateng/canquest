import { slugify } from "@/lib/routing/slug";

/**
 * User-facing routes — menu label matches URL path; content is swapped per product:
 *
 * - Menu **Earn** → `/earn` → partner campaigns (Quest Center)
 * - Menu **Quest** → `/quests` → CanQuest Earn hub (daily / social tasks)
 */
export const ROUTES = {
  /** Partner campaigns — open from Earn menu */
  campaignQuests: "/earn",
  campaignQuest: (questId: string, slug?: string) =>
    slug?.trim() ? `/earn/${questId}-${slugify(slug)}` : `/earn/${questId}`,
  /** CanQuest Earn hub — open from Quest menu */
  earnHub: "/quests",
  /** Rankings — below Wallet in nav */
  leaderboard: "/leaderboard",
  /** Wallet token detail — /wallet/cc, /wallet/cbtc, etc. */
  walletToken: (tokenId: string) => `/wallet/${tokenId}`,
} as const;
