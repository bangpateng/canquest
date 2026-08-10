import type { ReactNode } from "react";
import { cn } from "@/lib/utils/utils";

/**
 * Admonition / callout box, in the style of Mintlify's <Note>, <Warning>,
 * <Tip>, <Info> components. Uses the existing design tokens so it matches
 * the dark/light theme automatically.
 */
type CalloutType = "note" | "warning" | "tip" | "info";

const CALLOUT_STYLES: Record<
  CalloutType,
  { wrap: string; label: string; defaultTitle: string }
> = {
  note: {
    wrap: "border-canton-muted bg-canton-subtle",
    label: "text-[rgb(var(--canton-ink))]",
    defaultTitle: "Note",
  },
  warning: {
    wrap: "border-[rgb(var(--danger)/0.4)] bg-[rgb(var(--danger)/0.08)]",
    label: "text-[var(--danger)]",
    defaultTitle: "Warning",
  },
  tip: {
    wrap: "border-[rgb(var(--warn-rgb)/0.4)] bg-[rgb(var(--warn-rgb)/0.1)]",
    label: "text-[rgb(var(--warn-rgb))]",
    defaultTitle: "Tip",
  },
  info: {
    wrap: "border-[rgb(var(--success)/0.35)] bg-[rgb(var(--success)/0.08)]",
    label: "text-[var(--success)]",
    defaultTitle: "Info",
  },
};

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: CalloutType;
  title?: string;
  children: ReactNode;
}) {
  const s = CALLOUT_STYLES[type];
  return (
    <div className={cn("my-5 rounded-xl border px-4 py-3", s.wrap)}>
      <p className={cn("text-xs font-semibold uppercase tracking-wide", s.label)}>
        {title ?? s.defaultTitle}
      </p>
      <div className="mt-1.5 space-y-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
        {children}
      </div>
    </div>
  );
}
