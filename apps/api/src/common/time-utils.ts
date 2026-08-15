/**
 * Time helpers for quest cadence — single source of truth.
 *
 * Two distinct windows live here; do NOT conflate them:
 *
 * 1. ROLLING-24H COOLDOWN — Earn-hub repeatable tasks (daily_check_in,
 *    send_transaction, etc.) may be claimed again exactly 24h after the user's
 *    last verification. Use `ROLLING_24H_MS`, `isWithin24h()`,
 *    `msUntil24hExpires()`. This is the per-user cooldown gate.
 *
 * 2. UTC-DAY LOOKBACK — On-chain activity (sends/swaps/receives) is counted
 *    "since 00:00 UTC" to verify a task's real transactions for the current
 *    calendar day. Use `startOfTodayUtc()` / `msUntilNextUtcDay()`. This window
 *    is intentionally calendar-anchored so a user cannot reuse yesterday's
 *    transactions to satisfy today's task.
 *
 * Keep both in sync with the mirrored frontend helpers in
 * apps/web/lib/quest/quest-types.ts.
 */

/** Rolling cooldown window for daily repeatable tasks: 24 hours. */
export const ROLLING_24H_MS = 24 * 60 * 60 * 1000;

/** Returns true if `lastAt` is less than 24h before `now` (still on cooldown). */
export function isWithin24h(lastAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastAt.getTime() < ROLLING_24H_MS;
}

/** Milliseconds remaining until the 24h rolling window from `lastAt` expires. */
export function msUntil24hExpires(
  lastAt: Date,
  now: Date = new Date(),
): number {
  return Math.max(0, lastAt.getTime() + ROLLING_24H_MS - now.getTime());
}

/** Returns midnight (00:00:00.000) UTC for the day containing `now`. */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Async sleep — pengganti inline `new Promise((r) => setTimeout(r, ms))`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
