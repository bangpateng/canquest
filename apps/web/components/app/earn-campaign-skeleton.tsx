import { cn } from "@/lib/utils";

/** Matches QuestCard variant="earn" layout. */
export function EarnCampaignSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] ring-1 ring-[var(--border)]",
        className,
      )}
    >
      <div className="h-40 animate-pulse bg-[var(--muted)]/40 sm:h-44" />
      <div className="space-y-3 px-5 pb-5 pt-0">
        <div className="-mt-7 flex gap-3">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-[var(--muted)]/50 ring-2 ring-[var(--card)]" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="h-3 w-20 animate-pulse rounded bg-[var(--muted)]/40" />
            <div className="h-5 w-4/5 animate-pulse rounded bg-[var(--muted)]/55" />
          </div>
        </div>
        <div className="h-4 w-full animate-pulse rounded bg-[var(--muted)]/30" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--muted)]/25" />
        <div className="flex gap-2">
          <div className="h-7 w-20 animate-pulse rounded-lg bg-[var(--muted)]/35" />
          <div className="h-7 w-24 animate-pulse rounded-lg bg-[var(--muted)]/35" />
        </div>
        <div className="h-12 animate-pulse rounded-xl bg-[var(--muted)]/30" />
        <div className="h-11 animate-pulse rounded-full bg-[var(--muted)]/45" />
      </div>
    </div>
  );
}
