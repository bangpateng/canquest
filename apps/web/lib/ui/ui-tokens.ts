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

/** Permukaan kartu reward/claim — var-based (bukan hex hardcode), radius konsisten. */
export const rewardCardClass =
  "rounded-2xl border border-white/[0.06] bg-[var(--card)] backdrop-blur-2xl shadow-2xl shadow-black/40";

/** Banner sukses — dipakai claim cards & post-claim proof. */
export const successBannerClass =
  "rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300";

/** Banner error — dipakai claim cards & form. */
export const errorBannerClass =
  "rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-400";

/** Banner info/peringatan (orange). */
export const warnBannerClass =
  "rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-200";

export function surfaceCardClassName(className?: string) {
  return cn(surfaceCardClass, className);
}