import { cn } from "@/lib/utils/utils";

/** Matches EarnCampaignCard layout. */
export function EarnCampaignSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]",
        className,
      )}
    >
      <div className="h-[8rem] animate-pulse bg-[var(--muted)]/40 sm:h-[9.5rem]" />
      <div className="flex flex-1 flex-col space-y-4 px-6 pb-6 pt-4">
        <div className="flex gap-4">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-2xl bg-[var(--muted)]/50" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="h-3 w-20 animate-pulse rounded bg-[var(--muted)]/40" />
            <div className="h-5 w-full animate-pulse rounded bg-[var(--muted)]/55" />
          </div>
        </div>
        <div className="h-4 w-full animate-pulse rounded bg-[var(--muted)]/30" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--muted)]/25" />
        <div className="flex gap-4">
          <div className="h-4 w-16 animate-pulse rounded bg-[var(--muted)]/35" />
          <div className="h-4 w-24 animate-pulse rounded bg-[var(--muted)]/30" />
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/5">
          <div className="flex h-16 divide-x divide-slate-800/80">
            <div className="flex-1 animate-pulse bg-[var(--muted)]/25" />
            <div className="flex-1 animate-pulse bg-[var(--muted)]/20" />
          </div>
          <div className="h-10 animate-pulse border-t border-slate-800/80 bg-[var(--muted)]/15" />
        </div>
        <div className="mt-auto h-12 animate-pulse rounded-2xl bg-[var(--muted)]/45" />
      </div>
    </div>
  );
}
