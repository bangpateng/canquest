"use client";

import Link from "next/link";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { CheckCircle2, Sparkles, Ticket } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { getRewardConfig } from "@/lib/quest/quest-engine";
import { cn } from "@/lib/utils/utils";

type CampaignFcfsRewardCardProps = {
  mode: "claim" | "status";
  slotsLabel: string;
  description?: string | null;
  rewardCc?: number;
  partyId?: string | null;
  canClaim?: boolean;
  isSubmitting?: boolean;
  error?: string | null;
  success?: string | null;
  onClaim?: () => void;
  /** Override section label (default: FCFS reward). */
  sectionLabel?: string;
  /** Override claim button label. */
  claimButtonLabel?: string;
  /**
   * Tipe reward — menentukan icon badge (sesuai resolveIconKind di quest-engine):
   *  - CC token        → CC reward logo
   *  - Waitlist email  → Sparkles
   *  - Code            → Ticket
   *  - CC + Code       → CC logo + Ticket
   * Default (null) = CC reward logo (kompatibel perilaku lama).
   */
  rewardType?: string | null;
};

export function CampaignFcfsRewardCard({
  mode,
  slotsLabel,
  description,
  rewardCc = 0,
  partyId = null,
  canClaim = false,
  isSubmitting = false,
  error = null,
  success = null,
  onClaim,
  sectionLabel = "FCFS reward",
  claimButtonLabel,
  rewardType = null,
}: CampaignFcfsRewardCardProps) {
  const isStatus = mode === "status";
  const showClaimButton = mode === "claim" && canClaim && onClaim;

  // Resolve icon + warna badge berdasarkan tipe reward (sama seperti reward-reveal.tsx).
  const config = getRewardConfig(rewardType);
  const isDual = config.isDual;
  const isCcOnly = config.isCcToken && !isDual;
  const isWaitlist = config.code === "WAITLIST_EMAIL";

  return (
    <section className="overflow-hidden rounded-3xl border border-white/5 bg-[var(--card)]/40 px-6 py-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={cn(
              "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              isStatus
                ? "bg-[var(--muted)]/60 text-slate-400"
                : isDual
                  ? "bg-gradient-to-br from-canton/15 to-violet-500/15 text-violet-300"
                  : isCcOnly
                    ? "bg-[var(--primary)]/15 text-canton"
                    : isWaitlist
                      ? "bg-cyan-500/15 text-cyan-300"
                      : "bg-violet-500/15 text-violet-400",
            )}
          >
            {isStatus ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            ) : isDual ? (
              <span className="flex items-center justify-center gap-0.5">
                <CcRewardLogo size={16} />
                <Ticket className="h-4 w-4 text-violet-300" strokeWidth={2.5} aria-hidden />
              </span>
            ) : isCcOnly ? (
              <CcRewardLogo size={20} />
            ) : isWaitlist ? (
              <Sparkles className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            ) : (
              <Ticket className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {sectionLabel}
            </p>
            <p className="mt-1 text-base font-bold leading-snug text-slate-100">
              {slotsLabel}
            </p>
            {description ? (
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-400">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        {showClaimButton ? (
          <button
            type="button"
            disabled={isSubmitting || !partyId}
            onClick={onClaim}
            className={cn(
              buttonVariants({ size: "default" }),
              "w-full shrink-0 gap-2 sm:w-auto sm:min-w-[9.5rem]",
            )}
          >
            {isSubmitting ? <LoadingSpinner size="sm" /> : null}
            {isSubmitting ? "Claiming…" : (claimButtonLabel ?? "Claim")}
          </button>
        ) : null}
      </div>

      {mode === "claim" && !partyId ? (
        <p className="mt-4 text-sm font-medium text-orange-300">
          <Link href="/wallet" className="font-semibold underline underline-offset-2">
            Create your wallet
          </Link>{" "}
          first to claim on Canton.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-4 whitespace-pre-line rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
          {success}
        </p>
      ) : null}
    </section>
  );
}
