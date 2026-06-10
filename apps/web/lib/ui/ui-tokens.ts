import { cn } from "@/lib/utils/utils";

/** CanQuest — restrained Web3 dApp surfaces. No glassmorphism, minimal shadows. */

export const surfaceCardClass =
  "rounded-lg border border-[var(--border)] bg-[var(--card)]";

export const surfaceToolbarClass =
  "rounded-lg border border-[var(--border)] bg-[var(--muted)]";

export const surfaceInsetClass =
  "rounded-md border border-[var(--border)] bg-[var(--muted)]/50";

export const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)]/50 disabled:cursor-not-allowed disabled:opacity-50";

export const badgeMicroClass =
  "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

export const navItemClass =
  "font-medium transition-colors rounded-md";

export function surfaceCardClassName(className?: string) {
  return cn(surfaceCardClass, className);
}