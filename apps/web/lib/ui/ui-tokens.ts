import { cn } from "@/lib/utils/utils";

/**
 * CanQuest v2 UI tokens — refined Web3 quest platform surfaces.
 *
 * Design System:
 * - Cards / panels / modals → rounded-2xl with subtle glass morphism
 * - Primary CTAs / green buttons → rounded-xl (blocky confidence)
 * - Pills / filter chips / badges → rounded-full
 * - Inputs → rounded-xl with glow focus
 * - Icon containers → rounded-xl
 */

/** Premium glass card — main content panels */
export const surfaceCardClass =
  "rounded-2xl border border-white/[0.06] bg-[#0a0c14]/80 backdrop-blur-2xl shadow-2xl shadow-black/50";

/** Elevated card with deeper shadow */
export const surfaceCardElevatedClass =
  "rounded-2xl border border-white/[0.06] bg-[#0d0f1a]/90 backdrop-blur-2xl shadow-[0_8px_40px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.03)_inset]";

/** Filter bars, toolbars */
export const surfaceToolbarClass =
  "rounded-xl border border-white/[0.06] bg-[#0a0c14]/70 backdrop-blur-2xl";

/** Nested blocks inside cards */
export const surfaceInsetClass =
  "rounded-xl border border-white/[0.05] bg-white/[0.02]";

/** Text fields, search, selects — with green focus glow */
export const inputClass =
  "w-full rounded-xl border border-white/[0.08] bg-[#0a0c14]/80 px-4 py-2.5 text-sm font-medium text-slate-100 outline-none transition-all duration-200 placeholder:text-slate-500 focus:border-[var(--primary)]/40 focus:ring-2 focus:ring-[var(--ring)] focus:shadow-[0_0_20px_rgb(var(--canton-rgb)/0.08)] backdrop-blur-xl disabled:cursor-not-allowed disabled:opacity-50";

/** Small status / kind badges */
export const badgeMicroClass =
  "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider";

/** Nav item (sidebar + mobile) */
export const navItemClass =
  "font-medium transition-all duration-200 rounded-xl";

/** Section header bar */
export const sectionHeaderClass =
  "flex items-center justify-between border-b border-white/[0.06] bg-white/[0.01] px-5 py-4 sm:px-6 sm:py-5";

/** Empty state container */
export const emptyStateClass =
  "flex flex-col items-center justify-center gap-4 py-16 sm:py-20 text-center";

export function surfaceCardClassName(className?: string) {
  return cn(surfaceCardClass, className);
}