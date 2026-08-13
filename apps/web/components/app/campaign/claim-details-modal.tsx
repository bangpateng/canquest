"use client";

import { CheckCircle2, Sparkles, Ticket, X, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { iconButtonClass } from "@/lib/ui/ui-button-styles";
import { cn } from "@/lib/utils/utils";

/**
 * Pre-claim confirmation modal (mockup `claim-details-modal`).
 *
 * Shows a reward summary (hero amount, claim fee, network) and a
 * "Claim reward now" action. Pure presentation — the actual claim fetch runs in
 * the caller's `onConfirm` (the existing handleClaim). Reward data is supplied
 * by the caller; nothing is fabricated here.
 */
export interface ClaimRow {
  label: string;
  value: string;
  /** Render the value in the canton accent (e.g. a "Free" fee). */
  accent?: boolean;
}

interface ClaimDetailsModalProps {
  open: boolean;
  onClose: () => void;
  /** Headline reward, e.g. "5 CC" or "Waitlist spot". */
  heroAmount: string;
  /** Eyebrow above the hero, e.g. "Reward". */
  rewardLabel?: string;
  /** Detail rows (Claim fee / Network / Closes / …). */
  rows?: ClaimRow[];
  /** Optional eligibility strip text under the rows. */
  eligibleHint?: string;
  /** Optional hero token logo (CC / USDCx). Omit for a neutral ticket icon. */
  tokenHero?: "CC" | "USDCx";
  /** Optional campaign header (initials/logo + org name). */
  orgInitials?: string;
  orgName?: string;
  /** Confirm CTA label. */
  confirmLabel?: string;
  isConfirming?: boolean;
  onConfirm: () => void;
}

export function ClaimDetailsModal({
  open,
  onClose,
  heroAmount,
  rewardLabel = "Reward",
  rows = [],
  eligibleHint,
  tokenHero,
  orgInitials,
  orgName,
  confirmLabel = "Claim reward now",
  isConfirming = false,
  onConfirm,
}: ClaimDetailsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center overflow-y-auto p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Claim reward"
    >
      <button className="modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="relative z-10 my-auto w-full max-w-[380px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl claim-modal-pop">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--primary)]/5 to-transparent"
        />
        <div className="relative p-6">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--muted)] text-sm font-bold text-canton">
                {orgInitials ?? <Sparkles className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                {orgName ? (
                  <p className="truncate text-xs text-[var(--muted-foreground)]">{orgName}</p>
                ) : null}
                <p className="text-sm font-bold text-[var(--foreground)]">Claim Reward</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={iconButtonClass("h-8 w-8 shrink-0")}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Hero */}
          <div className="flex flex-col items-center text-center">
            {tokenHero === "CC" ? (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[var(--primary)]/20 to-transparent text-base font-black text-black ring-4 ring-[var(--primary)]/10">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-[11px] text-black">
                  C
                </span>
              </span>
            ) : tokenHero === "USDCx" ? (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[var(--primary)]/20 to-transparent ring-4 ring-[var(--primary)]/10">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-[11px] font-bold text-black">
                  U
                </span>
              </span>
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-canton-subtle text-canton ring-4 ring-white/5">
                <Ticket className="h-8 w-8" />
              </span>
            )}
            <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              {rewardLabel}
            </p>
            <p className="mt-1 text-3xl font-extrabold glow-text">{heroAmount}</p>
          </div>

          {/* Rows */}
          {rows.length > 0 ? (
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-black/20 px-4">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div className="h-px" />
                  <dt className="text-xs text-[var(--muted-foreground)]">{r.label}</dt>
                  <dd
                    className={cn(
                      "text-xs font-bold",
                      r.accent ? "text-canton" : "text-[var(--foreground)]",
                    )}
                  >
                    {r.value}
                  </dd>
                </div>
              ))}
            </div>
          ) : null}

          {eligibleHint ? (
            <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 text-xs font-medium text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {eligibleHint}
            </div>
          ) : null}

          {/* Footer */}
          <div className="mt-6">
            <Button className="h-12 w-full gap-2 text-sm" onClick={onConfirm} disabled={isConfirming}>
              {isConfirming ? <LoadingSpinner size="sm" /> : <Zap className="h-4 w-4" />}
              {confirmLabel}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="mt-1.5 h-10 w-full text-xs font-semibold text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
