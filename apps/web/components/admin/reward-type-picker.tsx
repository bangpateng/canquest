"use client";

import { getActiveRewardTypes, getRewardConfig } from "@/lib/quest/quest-engine";
import { cn } from "@/lib/utils/utils";
import { CheckCircle2 } from "lucide-react";

const REWARD_TYPES = getActiveRewardTypes();

/** Visual card picker for reward type — replaces the dropdown in quest-form.tsx. */
export function RewardTypePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {REWARD_TYPES.map((option) => {
        const config = getRewardConfig(option.code);
        const selected = value === option.code;

        return (
          <button
            key={option.code}
            type="button"
            onClick={() => onChange(option.code)}
            className={cn(
              "relative flex w-full flex-col gap-2 rounded-xl border p-4 text-left transition-all duration-150",
              selected
                ? "border-[var(--primary)]/60 bg-[var(--primary)]/[0.06] ring-1 ring-[var(--primary)]/30"
                : "border-[var(--border)] bg-[var(--muted)]/20 hover:border-[var(--primary)]/30 hover:bg-[var(--muted)]/40",
            )}
          >
            {/* Selected checkmark */}
            {selected ? (
              <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)]">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
            ) : null}

            {/* Type badge */}
            <span
              className={cn(
                "inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                config.chipClass,
              )}
            >
              {config.shortLabel}
            </span>

            {/* Label */}
            <p className={cn(
              "text-sm font-semibold leading-snug",
              selected ? "text-[var(--foreground)]" : "text-[var(--foreground)]/80",
            )}>
              {option.label}
            </p>

            {/* Hint */}
            <p className="line-clamp-2 text-xs leading-relaxed text-[var(--muted-foreground)]">
              {option.hint}
            </p>

            {/* Claim fee badge */}
            {option.defaultClaimFee != null ? (
              <p className="text-[10px] font-semibold text-[var(--muted-foreground)]">
                Default claim fee:{" "}
                <span className="font-bold text-amber-400">{option.defaultClaimFee} CC</span>
              </p>
            ) : (
              <p className="text-[10px] font-semibold text-[var(--muted-foreground)]">
                No on-chain claim fee
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
