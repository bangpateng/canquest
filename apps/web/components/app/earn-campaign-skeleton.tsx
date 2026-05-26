import { cn } from "@/lib/utils";

/** Matches EarnCampaignCard layout. */
export function EarnCampaignSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]",
        className,
      )}
    >
      <div className="h-[7.25rem] animate-pulse bg-[var(--muted)]/40 sm:h-[8.5rem]" />
      <div className="flex flex-1 flex-col space-y-3 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div className="flex gap-3">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-xl bg-[var(--muted)]/50" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-2.5 w-16 animate-pulse rounded bg-[var(--muted)]/40" />
            <div className="h-4 w-full animate-pulse rounded bg-[var(--muted)]/55" />
          </div>
        </div>
        <div className="h-3 w-full animate-pulse rounded bg-[var(--muted)]/30" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--muted)]/25" />
        <div className="flex gap-3">
          <div className="h-3 w-14 animate-pulse rounded bg-[var(--muted)]/35" />
          <div className="h-3 w-20 animate-pulse rounded bg-[var(--muted)]/30" />
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <div className="flex h-14 divide-x divide-[var(--border)]">
            <div className="flex-1 animate-pulse bg-[var(--muted)]/25" />
            <div className="flex-1 animate-pulse bg-[var(--muted)]/20" />
          </div>
          <div className="h-8 animate-pulse border-t border-[var(--border)] bg-[var(--muted)]/15" />
        </div>
        <div className="mt-auto h-10 animate-pulse rounded-xl bg-[var(--muted)]/45" />
      </div>
    </div>
  );
}
