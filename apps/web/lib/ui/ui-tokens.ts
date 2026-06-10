import { cn } from "@/lib/utils/utils";

/** CanQuest — simple Web3 dApp surfaces */

export const surfaceCardClass =
  "rounded-xl border border-[var(--border)] bg-[var(--card)]";

export const surfaceToolbarClass =
  "rounded-lg border border-[var(--border)] bg-[var(--muted)]";

export const surfaceInsetClass =
  "rounded-md border border-[var(--border)] bg-[var(--muted)]/50";

export const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]/50 disabled:opacity-50";

export function surfaceCardClassName(className?: string) {
  return cn(surfaceCardClass, className);
}