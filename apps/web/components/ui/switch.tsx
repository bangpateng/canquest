"use client";

import { cn } from "@/lib/utils/utils";

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:opacity-45",
        checked ? "bg-[var(--primary)]" : "bg-[var(--border)]",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 translate-x-1 translate-y-1 rounded-full shadow transition-transform duration-200",
          checked
            ? "translate-x-[1.375rem] bg-[var(--primary-foreground)]"
            : "translate-x-1 bg-[var(--background)]",
        )}
      />
    </button>
  );
}
