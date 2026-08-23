"use client";

import type { ReactNode } from "react";
import { Check, Sparkles, Ticket, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { RewardTokenLogo } from "@/components/app/campaign/reward-token-logo";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

/**
 * Pre-claim confirmation modal — "Claim Reward" (mockup editan user, rev.2).
 *
 * Solid card-solid surface, logo reward 44px (RewardTokenLogo — logo asli
 * CC/USDCx dari API), amount polos 36px, eligible strip teks polos,
 * CTA gradient rounded-xl. Tanpa ring, tanpa ikon dekoratif.
 * Pure presentation — the claim fetch runs in the caller's `onConfirm`.
 */
export interface ClaimRow {
  label: string;
  value: string;
  /** Render the value in the canton accent (e.g. a "Free" fee). */
  accent?: boolean;
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
  /** Estimasi USD live di bawah hero amount (mis. <TokenUsdValue />). */
  heroUsd?: ReactNode;
  /** Eyebrow above the hero, e.g. "Reward". */
  rewardLabel?: string;
  /** Detail rows (Claim fee / Slots / Network / Closes / …). */
  rows?: ClaimRow[];
  /** Optional eligibility line under the rows (plain text + check). */
  eligibleHint?: string;
  /** Logo reward di tengah: CC / USDCx (logo asli), CODE (ticket), WAITLIST (sparkles). */
  tokenHero?: "CC" | "USDCx" | "CODE" | "WAITLIST";
  /** Confirm CTA label. */
  confirmLabel?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
}

/** Logo reward di tengah modal — mengikuti tipe reward (44px, mockup rev.2). */
function ClaimTokenIcon({ token }: { token?: "CC" | "USDCx" | "CODE" | "WAITLIST" }) {
  if (token === "CC" || token === "USDCx") {
    return <RewardTokenLogo token={token} size={44} circular />;
  }
  if (token === "WAITLIST") {
    return (
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-cyan-500/[0.14] text-cyan-600 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
        <Sparkles className="h-[22px] w-[22px]" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-violet-500/[0.14] text-violet-600 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
      <Ticket className="h-[22px] w-[22px]" aria-hidden />
    </span>
  );
}

export function ClaimDetailsModal({
  open,
  onClose,
  heroValue,
  heroUnit,
  heroAmount,
  heroUsd,
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
      <div className="claim-modal-pop relative z-10 my-auto max-h-[min(92vh,92dvh)] w-full max-w-[400px] overflow-y-auto rounded-[20px] border border-[var(--border)] bg-[var(--card-solid)] p-7 pb-6 shadow-[0_20px_44px_-24px_rgb(0_0_0/0.8)]">
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
        <div className="mb-4 flex flex-col items-center">
          <ClaimTokenIcon token={tokenHero} />
          <p className="mb-1.5 mt-3.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
            {rewardLabel}
          </p>
          <p className="text-4xl font-bold leading-none tracking-[-0.02em] tabular-nums text-[var(--foreground)]">
            {headline}
            {heroUnit ? (
              <span className="ml-1 text-base font-semibold text-[var(--muted-foreground)]">
                {heroUnit}
              </span>
            ) : null}
          </p>
          {heroUsd ? (
            <p className="mt-1.5 text-sm font-medium text-[var(--muted-foreground)]">
              {heroUsd}
            </p>
          ) : null}
        </div>

        {/* Stat panel */}
        {rows.length > 0 ? (
          <div className="mb-4 rounded-[14px] border border-[var(--border)] bg-[var(--muted)] px-4 py-1">
            {rows.map((r, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-between py-[11px]",
                  i < rows.length - 1 && "border-b border-[var(--border)]",
                )}
              >
                <span className="text-sm text-[var(--muted-foreground)]">{r.label}</span>
                <span className="flex items-center gap-1.5 font-mono text-sm font-medium text-[var(--foreground)]">
                  <span className={r.accent ? "text-canton" : undefined}>{r.value}</span>
                  {r.tag ? (
                    <span className="rounded-[20px] border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600">
                      {r.tag}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Eligibility — plain text line with mint check (mockup rev.2) */}
        {eligibleHint ? (
          <p className="flex items-center gap-2 px-0.5 pb-[18px] text-xs text-[var(--muted-foreground)]">
            <Check className="h-[15px] w-[15px] shrink-0 text-canton" strokeWidth={2.4} aria-hidden />
            {eligibleHint}
          </p>
        ) : null}

        {/* CTA */}
        <div>
          <Button
            className="h-[50px] w-full rounded-xl text-sm font-bold shadow-[0_8px_20px_-12px_rgb(94_232_156/0.45)]"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? <LoadingSpinner size="sm" /> : null}
            {confirmLabel}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="w-full pb-0.5 pt-3.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
