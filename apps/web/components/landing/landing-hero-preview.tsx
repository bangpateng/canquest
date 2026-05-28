/** Decorative app preview for the marketing hero (no live data). */
export function LandingHeroPreview() {
  return (
    <div
      className="relative mx-auto w-full max-w-md lg:mx-0 lg:max-w-none"
      aria-hidden
    >
      <div className="absolute -inset-4 rounded-3xl bg-[rgb(var(--canton-rgb)/0.12)] blur-2xl" />
      <div className="relative space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 p-4 shadow-2xl ring-1 ring-white/[0.04] backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
          <div className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-400/80" />
            <span className="h-2 w-2 rounded-full bg-amber-400/80" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
          </div>
          <span className="text-[10px] font-medium text-[var(--muted-foreground)]">canquest.cc</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2 h-20 rounded-xl bg-gradient-to-br from-[var(--primary)]/25 to-transparent p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-canton">Earn</p>
            <p className="mt-1 text-sm font-bold text-[var(--foreground)]">Partner drop live</p>
          </div>
          <div className="h-16 rounded-xl bg-[var(--muted)]/50 p-2.5">
            <p className="text-[9px] text-[var(--muted-foreground)]">Quest</p>
            <p className="mt-1 text-xs font-semibold">+120 pts</p>
          </div>
          <div className="h-16 rounded-xl bg-[var(--muted)]/50 p-2.5">
            <p className="text-[9px] text-[var(--muted-foreground)]">Wallet</p>
            <p className="mt-1 text-xs font-semibold tabular-nums text-canton">248 CC</p>
          </div>
        </div>
        <div className="flex gap-2">
          <span className="h-8 flex-1 rounded-full bg-[var(--primary)]/90" />
          <span className="h-8 w-8 rounded-full bg-[var(--muted)]" />
        </div>
      </div>
    </div>
  );
}
