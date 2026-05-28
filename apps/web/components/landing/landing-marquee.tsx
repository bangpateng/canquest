const ITEMS = [
  "FCFS slots",
  "Raffle draws",
  "Quest hub",
  "Spin wheel",
  "Party wallet",
  "Leaderboard",
  "On-chain CC",
  "Invite codes",
] as const;

export function LandingMarquee() {
  const track = [...ITEMS, ...ITEMS];

  return (
    <div className="border-b border-[var(--border)] bg-[var(--card)]/40 py-3 overflow-hidden">
      <div
        className="landing-marquee-track flex w-max gap-10 px-4"
        aria-hidden
      >
        {track.map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="shrink-0 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted-foreground)]/80"
          >
            {label}
          </span>
        ))}
      </div>
      <p className="sr-only">Platform capabilities: {ITEMS.join(", ")}</p>
    </div>
  );
}
