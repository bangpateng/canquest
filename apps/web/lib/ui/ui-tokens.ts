import { cn } from "@/lib/utils/utils";

/**
 * CanQuest UI tokens — single source for radius, surfaces, inputs.
 *
 * Radius rules (Premium Design System):
 * - Primary action buttons / green CTAs → rounded-md or rounded-lg (blocky/square-edged)
 * - Pills / filter chips / badges → rounded-full
 * - Inputs / inset blocks → rounded-xl
 * - Cards / panels / modals → rounded-2xl or rounded-3xl
 * - Icon containers (small) → rounded-lg
 */

/** Cards, modals, auth shells — glassmorphic premium */
export const surfaceCardClass =
  "rounded-2xl border border-white/[0.05] bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/40";

/** Filter bars, toolbars */
export const surfaceToolbarClass =
  "rounded-2xl border border-white/[0.06] bg-slate-900/40 backdrop-blur-xl";

/** Nested blocks inside cards */
export const surfaceInsetClass =
  "rounded-xl border border-white/[0.05] bg-white/[0.02]";

/** Text fields, search, selects */
export const inputClass =
  "w-full rounded-xl border border-white/[0.06] bg-slate-900/40 px-4 py-2.5 text-sm font-medium text-slate-100 outline-none transition-all duration-200 placeholder:text-slate-500 focus:border-[var(--primary)]/40 focus:ring-2 focus:ring-[var(--ring)] backdrop-blur-xl disabled:cursor-not-allowed disabled:opacity-50";

/** Small status / kind badges */
export const badgeMicroClass =
  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider";

/** Nav item (sidebar + mobile) */
export const navItemClass =
  "font-medium transition-all duration-200 rounded-lg";

export function surfaceCardClassName(className?: string) {
  return cn(surfaceCardClass, className);
}
