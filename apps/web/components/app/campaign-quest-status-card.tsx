"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type StatusTone = "sky" | "amber" | "emerald" | "neutral";

const toneStyles: Record<
  StatusTone,
  { border: string; iconBg: string; iconColor: string; labelColor: string }
> = {
  sky: {
    border: "border-sky-500/30",
    iconBg: "bg-sky-500/15",
    iconColor: "text-sky-400",
    labelColor: "text-sky-300/80",
  },
  amber: {
    border: "border-amber-500/30",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    labelColor: "text-amber-300/80",
  },
  emerald: {
    border: "border-emerald-500/30",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    labelColor: "text-emerald-300/80",
  },
  neutral: {
    border: "border-[var(--border)]",
    iconBg: "bg-[var(--muted)]/60",
    iconColor: "text-[var(--muted-foreground)]",
    labelColor: "text-[var(--muted-foreground)]",
  },
};

export function CampaignQuestStatusCard({
  tone = "neutral",
  label,
  title,
  description,
  icon: Icon,
}: {
  tone?: StatusTone;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  const styles = toneStyles[tone];

  return (
    <section
      className={cn(
        "rounded-xl border bg-[var(--card)] px-4 py-3.5 sm:px-5 sm:py-4",
        styles.border,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            styles.iconBg,
            styles.iconColor,
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              styles.labelColor,
            )}
          >
            {label}
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-[var(--foreground)]">
            {title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
            {description}
          </p>
        </div>
      </div>
    </section>
  );
}
