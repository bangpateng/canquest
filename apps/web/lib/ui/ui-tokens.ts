import { cn } from "@/lib/utils/utils";

/** Clean surfaces like cantonloop */

export const surfaceCardClass =
  "rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm";

export const surfaceToolbarClass =
  "rounded-lg border border-[var(--border)] bg-[var(--muted)]";

export const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]/50 transition-colors disabled:opacity-50";

export const badgeMicroClass =
  "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

export function surfaceCardClassName(className?: string) {
  return cn(surfaceCardClass, className);
}