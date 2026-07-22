/**
 * UTC day helpers — single source of truth for "daily" reset boundaries.
 *
 * Quests (EARN_HUB daily tasks) reset at 00:00 UTC. For WIB users that is 07:00
 * local time. All reset logic MUST go through these helpers so the boundary is
 * consistent across the backend (cooldown enforcement, progress windows,
 * leaderboard periods) and the mirrored frontend helpers.
 */

/** Returns midnight (00:00:00.000) UTC for the day containing `now`. */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Milliseconds remaining until the next 00:00 UTC boundary. */
export function msUntilNextUtcDay(now: Date = new Date()): number {
  const next = startOfTodayUtc(now);
  next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

/**
 * Stable UTC day key ("YYYY-MM-DD") — useful as an idempotency key for
 * once-per-day operations (e.g. daily completion bonus dedup).
 */
export function getUtcDayKey(now: Date = new Date()): string {
  return startOfTodayUtc(now).toISOString().slice(0, 10);
}

/**
 * True if `when` falls inside the current UTC day (i.e. on or after the most
 * recent 00:00 UTC). Returns false for null/undefined.
 */
export function isTodayUtc(when: Date | null | undefined, now: Date = new Date()): boolean {
  if (!when) return false;
  return when.getTime() >= startOfTodayUtc(now).getTime();
}
