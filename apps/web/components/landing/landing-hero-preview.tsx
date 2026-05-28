import { CcRewardLogo } from "@/components/app/cc-reward-logo";

/** Decorative app preview for the marketing hero (no live data). */
export function LandingHeroPreview() {
  return (
    <div
      className="relative mx-auto w-full max-w-md lg:mx-0 lg:max-w-none"
      aria-hidden
    >
      <div className="landing-float-slow absolute -right-4 top-8 z-0 w-[42%] rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 p-3 opacity-60 shadow-lg ring-1 ring-white/[0.03] backdrop-blur-sm">
        <p className="text-[9px] font-medium text-[var(--muted-foreground)]">Spin</p>
        <p className="mt-2 h-8 w-8 rounded-full border-2 border-dashed border-canton/40" />
      </div>

      <div className="landing-float relative z-10">
        <div className="absolute -inset-4 rounded-3xl bg-[rgb(var(--canton-rgb)/0.14)] blur-2xl" />
        <div className="relative space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)]/95 p-4 shadow-2xl ring-1 ring-white/[0.05] backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
            <div className="flex gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-400/80" />
              <span className="h-2 w-2 rounded-full bg-amber-400/80" />
              <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
            </div>
            <span className="text-[10px] font-medium text-[var(--muted-foreground)]">
              canquest.cc
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2 flex h-20 items-center gap-3 rounded-xl bg-gradient-to-br from-[var(--primary)]/20 via-[var(--primary)]/8 to-transparent p-3">
              <CcRewardLogo size={28} />
              <div className="min-w-0 text-left">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-canton">
                  Earn
                </p>
                <p className="truncate text-sm font-bold text-[var(--foreground)]">
                  Slot 4/5 filled
                </p>
              </div>
            </div>
            <div className="h-16 rounded-xl bg-[var(--muted)]/50 p-2.5">
              <p className="text-[9px] text-[var(--muted-foreground)]">Quest</p>
              <p className="mt-1 text-xs font-semibold tabular-nums">+120</p>
            </div>
            <div className="h-16 rounded-xl bg-[var(--muted)]/50 p-2.5">
              <p className="text-[9px] text-[var(--muted-foreground)]">Rank</p>
              <p className="mt-1 text-xs font-semibold text-canton">#12</p>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
            <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
