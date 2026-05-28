import { cn } from "@/lib/utils";

/**
 * CanQuest UI tokens — single source for radius, surfaces, inputs.
 *
 * Radius rules:
 * - Buttons / primary CTAs → rounded-lg (use buttonVariants)
 * - Pills / filter chips → rounded-full
 * - Inputs / inset blocks → rounded-xl
 * - Cards / panels → rounded-2xl
 */

/** Cards, modals, auth shells */
export const surfaceCardClass =
  "rounded-2xl border border-[var(--border)] bg-[var(--card)]";

/** Filter bars, toolbars */
export const surfaceToolbarClass =
  "rounded-2xl border border-[var(--border)] bg-[var(--card)]/40";

/** Nested blocks inside cards */
export const surfaceInsetClass =
  "rounded-xl border border-[var(--border)] bg-[var(--muted)]/20";

/** Text fields, search, selects */
export const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--card)]/80 px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-all duration-200 placeholder:text-[var(--muted-foreground)] focus-visible:border-[var(--primary)]/40 focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50";

/** Small status / kind badges */
export const badgeMicroClass =
  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider";

/** Nav item (sidebar + mobile) */
export const navItemClass =
  "font-medium transition-all duration-200 rounded-xl";

export function surfaceCardClassName(className?: string) {
  return cn(surfaceCardClass, className);
}
