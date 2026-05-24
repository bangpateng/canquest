import { cn } from "@/lib/utils";

export function EarnCampaignSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/60",
        className,
      )}
    >
      <div className="flex gap-4 p-4 sm:p-5">
        <div className="h-12 w-12 shrink-0 animate-pulse rounded-2xl bg-[var(--muted)]/50" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="h-3 w-24 animate-pulse rounded bg-[var(--muted)]/40" />
          <div className="h-5 w-2/3 animate-pulse rounded bg-[var(--muted)]/55" />
          <div className="h-4 w-full animate-pulse rounded bg-[var(--muted)]/30" />
          <div className="flex justify-between pt-1">
            <div className="h-3 w-32 animate-pulse rounded bg-[var(--muted)]/35" />
            <div className="h-9 w-24 animate-pulse rounded-full bg-[var(--muted)]/45" />
          </div>
        </div>
      </div>
      <div className="h-11 animate-pulse border-t border-[var(--border)] bg-[var(--muted)]/20" />
    </div>
  );
}
