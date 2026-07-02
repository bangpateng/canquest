/**
 * Centralized TanStack Query key factory.
 *
 * Mengikuti konvensi "query key hierarchy" react-query:
 * https://tkdodo.eu/blog/effective-react-query-keys#use-query-key-factories
 *
 * Hierarki ini memungkinkan invalidasi granular ATAU luas:
 *   - invalidateQueries({ queryKey: queryKeys.party.all })       // semua data party
 *   - invalidateQueries({ queryKey: queryKeys.party.balance })   // hanya balance
 *   - invalidateQueries({ queryKey: queryKeys.party.transactions.all }) // semua halaman tx
 */

export const queryKeys = {
  party: {
    all: ["party"] as const,
    /** Current user profile (/api/me). Shared by all components so /api/me
     *  is fetched ONCE per stale window, not 6× per navigation. */
    me: ["party", "me"] as const,
    balance: ["party", "balance"] as const,
    lockStatus: ["party", "lock-status"] as const,
    ccPrice: ["party", "cc-price"] as const,
    offers: ["party", "offers"] as const,
    notifications: ["party", "notifications"] as const,
    transactions: {
      all: ["party", "transactions"] as const,
      /** Transactions list untuk halaman tertentu (paginasi client-side). */
      page: (page: number) => ["party", "transactions", page] as const,
    },
  },

  quests: {
    all: ["quests"] as const,
    /** Progress quest individual (termasuk status task & submission). */
    progress: (questId: string) => ["quests", questId, "progress"] as const,
  },
} as const;
