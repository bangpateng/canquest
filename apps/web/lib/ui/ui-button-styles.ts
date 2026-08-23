import { cn } from "@/lib/utils/utils";

/** Period / status filter pills (Weekly, Active, etc.) — active = brand gradient.
 *  Ukuran pill compact (padding 6px 12px, 11.5px semibold) — cukup terlihat
 *  sebagai tombol dengan state hijau gradient saat terpilih. */
export function filterTabClass(selected: boolean, className?: string) {
  return cn(
    "shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-[10px] font-semibold tracking-wide transition-all",
    selected
      ? "border-0 bg-gradient-brand text-[var(--primary-foreground)] shadow-[0_6px_16px_-8px_rgb(var(--canton-rgb)/0.6)]"
      : "border border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:border-[var(--primary)]/35 hover:text-[var(--foreground)]",
    className,
  );
}

/** Prev / Next pagination controls */
export function paginationButtonClass(disabled: boolean, className?: string) {
  return cn(
    "inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-all",
    disabled
      ? "cursor-not-allowed border-[var(--border)] bg-[var(--card)]/60 text-[var(--muted-foreground)] opacity-40"
      : "border-[var(--border)] bg-[var(--card)]/80 text-[var(--foreground)] hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10",
    className,
  );
}

/** Underline tabs (admin panels) */
export function underlineTabClass(selected: boolean, className?: string) {
  return cn(
    "pb-2.5 text-sm font-semibold transition-colors",
    selected
      ? "border-b-2 border-[var(--primary)] text-[var(--foreground)]"
      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
    className,
  );
}

/** Small icon-only control (toolbar, copy, close).
 *
 *  Self-contained: provides its own surface background + explicit icon
 *  color via tokens so the lucide SVG (stroke=currentColor) is ALWAYS
 *  visible on every surface/theme, no matter where it's rendered. */
export function iconButtonClass(className?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--card)]/80 text-[var(--foreground)] transition-[border-color,background-color,color,transform] hover:-translate-y-px hover:border-[var(--primary)]/35 hover:bg-[var(--primary)]/10 hover:text-[var(--primary-strong)] disabled:pointer-events-none disabled:opacity-50",
    className,
  );
}

/** Compact toolbar trigger (language menu) */
export function toolbarMenuButtonClass(className?: string) {
  return cn(
    "flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-2.5 text-xs font-semibold text-[var(--foreground)] transition-all hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10 sm:px-3",
    className,
  );
}
