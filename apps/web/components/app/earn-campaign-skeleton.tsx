import { cn } from "@/lib/utils";

/** Matches QuestCard variant="earn" layout. */
export function EarnCampaignSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] ring-1 ring-[var(--border)]",
        className,
      )}
    >
      <div className="h-[7.5rem] animate-pulse bg-[var(--muted)]/40 sm:h-36" />
      <div className="flex flex-1 flex-col space-y-3 px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
        <div className="-mt-6 flex gap-3 sm:-mt-7">
          <div className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-[var(--muted)]/50 ring-2 ring-[var(--card)]" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="h-2.5 w-16 animate-pulse rounded bg-[var(--muted)]/40" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-[var(--muted)]/55" />
          </div>
        </div>
        <div className="h-3.5 w-full animate-pulse rounded bg-[var(--muted)]/30" />
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-[var(--muted)]/25" />
        <div className="flex gap-1.5">
          <div className="h-6 w-[4.5rem] animate-pulse rounded-md bg-[var(--muted)]/35" />
          <div className="h-6 w-20 animate-pulse rounded-md bg-[var(--muted)]/35" />
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <div className="h-16 animate-pulse bg-[var(--muted)]/35" />
          <div className="grid grid-cols-2 divide-x divide-[var(--border)] border-t border-[var(--border)]">
            <div className="h-14 animate-pulse bg-[var(--muted)]/25" />
            <div className="h-14 animate-pulse bg-[var(--muted)]/20" />
          </div>
        </div>
        <div className="mt-auto h-10 animate-pulse rounded-full bg-[var(--muted)]/45" />
      </div>
    </div>
  );
}
