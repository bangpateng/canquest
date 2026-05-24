/** Skip rapid repeat refetches (tab focus / visibility) that make the app feel sluggish. */
export function createRefetchThrottle(minIntervalMs: number) {
  let lastRunAt = 0;

  return (run: () => void) => {
    const now = Date.now();
    if (now - lastRunAt < minIntervalMs) return;
    lastRunAt = now;
    run();
  };
}
