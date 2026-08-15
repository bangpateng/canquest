"use client";

import { Check, Sparkles, Ticket, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { RewardTokenLogo } from "@/components/app/campaign/reward-token-logo";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

/**
 * Pre-claim confirmation modal — "Claim Reward" (uploaded mockup, revised).
 *
 * Center badge = logo ASLI sesuai tipe reward (CC/USDCx via RewardTokenLogo,
 * code = ticket, waitlist = sparkles) — tanpa ring animasi.
 * Pure presentation — the claim fetch runs in the caller's `onConfirm`.
 */
export interface ClaimRow {
  label: string;
  value: string;
  /** Render the value in the canton accent (e.g. a "Free" fee). */
  accent?: boolean;
  /** Cyan network dot before the value (Network row). */
  dot?: boolean;
  /** Amber chip after the value (e.g. "1 left" on the Slots row). */
  tag?: string;
}

interface ClaimDetailsModalProps {
  open: boolean;
  onClose: () => void;
  /** Headline reward value, e.g. "0.01" — rendered large. */
  heroValue?: string;
  /** Small unit suffix, e.g. "CC" or "invite code". */
  heroUnit?: string;
  /** Fallback whole-string headline when heroValue/heroUnit are omitted. */
  heroAmount?: string;
  /** Eyebrow above the hero, e.g. "Reward". */
  rewardLabel?: string;
  /** Detail rows (Claim fee / Slots / Network / Closes / …). */
  rows?: ClaimRow[];
  /** Optional eligibility strip text under the rows. */
  eligibleHint?: string;
  /** Logo reward di tengah: CC / USDCx (logo asli), CODE (ticket), WAITLIST (sparkles). */
  tokenHero?: "CC" | "USDCx" | "CODE" | "WAITLIST";
  /** Confirm CTA label. */
  confirmLabel?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
}

/** Logo reward di tengah modal — mengikuti tipe reward. */
function ClaimTokenIcon({ token }: { token?: "CC" | "USDCx" | "CODE" | "WAITLIST" }) {
  if (token === "CC" || token === "USDCx") {
    return <RewardTokenLogo token={token} size={64} circular />;
  }
  if (token === "WAITLIST") {
    return (
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-300 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
        <Sparkles className="h-8 w-8" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/15 text-violet-300 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
      <Ticket className="h-8 w-8" aria-hidden />
    </span>
  );
}

export function ClaimDetailsModal({
  open,
  onClose,
  heroValue,
  heroUnit,
  heroAmount,
  rewardLabel = "Reward",
  rows = [],
  eligibleHint,
  tokenHero,
  confirmLabel = "Claim reward now",
  isConfirming = false,
  onConfirm,
}: ClaimDetailsModalProps) {
  if (!open) return null;

  const headline = heroValue ?? heroAmount ?? "";

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Claim reward"
    >
      <button className="modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="claim-modal-pop relative z-10 my-auto max-h-[min(92vh,92dvh)] w-full max-w-[400px] overflow-y-auto rounded-[20px] border border-[var(--border)] bg-gradient-to-b from-[var(--card)] to-[var(--card-solid)] p-7 pb-6 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7),inset_0_0_0_1px_rgb(255_255_255/0.02)]">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="text-base font-semibold tracking-tight text-[var(--foreground)]">
            Claim Reward
          </div>
          <button
            type="button"
            onClick={onClose}
            className={iconButtonClass("h-[30px] w-[30px] shrink-0 rounded-[9px]")}
            aria-label="Close"
          >
            <X className="h-3 w-3" strokeWidth={2.4} />
          </button>
        </div>

        {/* Reward logo + hero amount */}
        <div className="mb-5 flex flex-col items-center">
          <ClaimTokenIcon token={tokenHero} />
          <p className="mb-1.5 mt-4 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {rewardLabel}
          </p>
          <p className="text-[38px] font-bold leading-none tracking-[-0.02em]">
            <span className="bg-gradient-to-r from-[var(--foreground)] to-[var(--muted-foreground)] bg-clip-text text-transparent">
              {headline}
            </span>
            {heroUnit ? (
              <span className="ml-1 text-[17px] font-semibold text-[var(--muted-foreground)]">
                {heroUnit}
              </span>
            ) : null}
          </p>
        </div>

        {/* Stat panel */}
        {rows.length > 0 ? (
          <div className="mb-4 rounded-[14px] border border-[var(--border)] bg-[var(--muted)] px-4 py-1">
            {rows.map((r, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-between py-[13px]",
                  i < rows.length - 1 && "border-b border-[var(--border)]",
                )}
              >
                <span className="text-[13px] text-[var(--muted-foreground)]">{r.label}</span>
                <span className="flex items-center gap-1.5 font-mono text-[13px] font-medium text-[var(--foreground)]">
                  {r.dot ? (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]"
                      aria-hidden
                    />
                  ) : null}
                  <span className={r.accent ? "text-canton" : undefined}>{r.value}</span>
                  {r.tag ? (
                    <span className="rounded-[20px] border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10.5px] text-amber-300">
                      {r.tag}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Eligibility strip */}
        {eligibleHint ? (
          <div className="mb-4 flex items-center gap-2.5 rounded-[12px] border border-[rgb(var(--canton-rgb)/0.22)] bg-[rgb(var(--canton-rgb)/0.08)] px-3.5 py-2.5 text-[12.5px] text-canton">
            <Check className="h-[15px] w-[15px] shrink-0" strokeWidth={2.4} aria-hidden />
            {eligibleHint}
          </div>
        ) : null}

        {/* CTA */}
        <div>
          <Button
            className="h-[52px] w-full rounded-[13px] text-[14.5px] font-bold"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? <LoadingSpinner size="sm" /> : null}
            {confirmLabel}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="w-full pb-0.5 pt-3.5 text-[12.5px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
