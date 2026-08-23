"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils/utils";

/**
 * CampaignStatusRow — baris status compact satu baris (mockup editan user:
 * `mockup-reward-status-states.html`). `[icon bulat 20px] Tipe — pesan`.
 *
 * Warna mengikuti STATUS, bukan tipe reward:
 * emerald = sukses/menang · sky = tercatat · amber = menunggu ·
 * neutral = ditutup/tidak terpilih.
 */
const TONE_ICON: Record<CampaignStatusRowTone, string> = {
  neutral: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  emerald: "bg-emerald-400/15 text-emerald-600",
  sky: "bg-sky-400/15 text-sky-600",
  amber: "bg-amber-400/15 text-amber-600",
};

export type CampaignStatusRowTone = "neutral" | "emerald" | "sky" | "amber";

export function CampaignStatusRow({
  tone = "neutral",
  icon: Icon,
  strokeWidth = 2.8,
  label,
  children,
  className,
}: {
  tone?: CampaignStatusRowTone;
  icon?: LucideIcon;
  /** Simbol garis ikon (2.8 utk check/x, 2.4 utk ikon lain — mockup). */
  strokeWidth?: number;
  /** Prefix bold, mis. "FCFS Reward". */
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3.5 py-[11px]",
        className,
      )}
    >
      {Icon ? (
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            TONE_ICON[tone],
          )}
        >
          <Icon className="h-[11px] w-[11px]" strokeWidth={strokeWidth} aria-hidden />
        </span>
      ) : null}
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
        {label ? (
          <span className="font-semibold text-[var(--foreground)]">{label}</span>
        ) : null}
        {label ? " — " : ""}
        {children}
      </p>
    </div>
  );
}
