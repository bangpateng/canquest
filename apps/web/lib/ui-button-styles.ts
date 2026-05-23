import { cn } from "@/lib/utils";

/** Period / status filter pills (Weekly, Active, etc.) */
export function filterTabClass(selected: boolean, className?: string) {
  return cn(
    "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-all",
    selected
      ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_0_20px_rgb(var(--canton-rgb)/0.2)]"
      : "border border-[var(--border)] bg-[var(--card)]/80 text-[var(--muted-foreground)] hover:border-[var(--primary)]/30 hover:text-[var(--foreground)]",
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

/** Small icon-only control (toolbar, copy, close) */
export function iconButtonClass(className?: string) {
  return cn(
    "inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)]/80 text-[var(--muted-foreground)] transition-all hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10 hover:text-[var(--foreground)] disabled:opacity-40",
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
