import { SpinDemo } from "@/components/app/spin-demo";
import { cn } from "@/lib/utils";

/** Flip to false when Spin goes live — UI below stays in the tree. */
const SPIN_COMING_SOON = true;

export default function SpinPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Reward engine preview
          </p>
          {SPIN_COMING_SOON && (
            <span className="rounded-full border border-orange-500/40 bg-orange-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-200 dark:text-orange-200">
              Coming soon
            </span>
          )}
        </div>
        <h2 className="type-page-title mt-1">
          Spend points, roll the pool
        </h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Client-side only: balances and outcomes reset on reload. Backend will
          own inventory, RNG, and ledger journaling.
          {SPIN_COMING_SOON && (
            <> The demo below stays for layout QA — spins are paused until launch.</>
          )}
        </p>
      </div>

      <div className="relative">
        <div
          aria-hidden={SPIN_COMING_SOON}
          className={cn(SPIN_COMING_SOON && "pointer-events-none select-none opacity-[0.5] saturate-75")}
        >
          <SpinDemo />
        </div>
        {SPIN_COMING_SOON && (
          <div className="absolute inset-0 z-10 flex min-h-[280px] items-center justify-center bg-[var(--background)]/70 backdrop-blur-sm">
            <div
              role="status"
              className="mx-4 flex max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 text-center shadow-lg"
            >
              <p className="type-section-title text-[var(--foreground)]">
                Coming soon
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                Spin rewards are not available yet. All preview data below remains in place for when we turn this on — nothing has been removed.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}