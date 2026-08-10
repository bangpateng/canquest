"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";
import type { LucideIcon } from "lucide-react";

type StatusTone = "sky" | "amber" | "emerald" | "neutral";

// Border & radius disamakan untuk semua tone (konsisten dengan sidebar/task cards).
// Warna tone hanya mempengaruhi label + iconBg (bukan border card).
const toneStyles: Record<
  StatusTone,
  { iconBg: string; iconColor: string; labelColor: string }
> = {
  sky: {
    iconBg: "bg-sky-500/15",
    iconColor: "text-sky-400",
    labelColor: "text-sky-300/80",
  },
  amber: {
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    labelColor: "text-amber-300/80",
  },
  emerald: {
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    labelColor: "text-emerald-300/80",
  },
  neutral: {
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
  icon?: LucideIcon;
}) {
  const styles = toneStyles[tone];

  return (
    <Card className="overflow-hidden px-6 py-5">
      <div className="flex min-w-0 items-start gap-4">
        {Icon ? (
          <div
            className={cn(
              "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              styles.iconBg,
              styles.iconColor,
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </div>
        ) : null}
        <div className="min-w-0">
          <p
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wider",
              styles.labelColor,
            )}
          >
            {label}
          </p>
          <p className="mt-1 text-base font-bold leading-snug text-[var(--foreground)]">
            {title}
          </p>
          <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--muted-foreground)]">
            {description}
          </p>
        </div>
      </div>
    </Card>
  );
}
