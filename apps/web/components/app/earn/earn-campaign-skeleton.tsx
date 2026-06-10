"use client";
import { cn } from "@/lib/utils/utils";

export function EarnCampaignSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] animate-pulse", className)}>
      <div className="h-28 bg-[var(--muted)]" />
      <div className="flex flex-1 flex-col p-4 gap-3">
        <div className="flex items-center gap-2.5"><div className="h-8 w-8 rounded-md bg-[var(--muted)]" /><div className="flex-1"><div className="h-3 w-16 bg-[var(--muted)] rounded" /><div className="mt-1 h-4 w-32 bg-[var(--muted)] rounded" /></div></div>
        <div className="h-3 w-full bg-[var(--muted)] rounded" />
        <div className="h-3 w-2/3 bg-[var(--muted)] rounded" />
        <div className="mt-auto pt-3 h-9 bg-[var(--muted)] rounded-md" />
      </div>
    </div>
  );
}