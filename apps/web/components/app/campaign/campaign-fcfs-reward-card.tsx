"use client";

import Link from "next/link";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { CheckCircle2 } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
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
}: CampaignFcfsRewardCardProps) {
  const isStatus = mode === "status";
  const showClaimButton = mode === "claim" && canClaim && onClaim;

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/40 px-4 py-3.5 sm:px-5 sm:py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              isStatus
                ? "bg-[var(--muted)]/60 text-[var(--muted-foreground)]"
                : "bg-[var(--primary)]/15 text-canton",
            )}
          >
            {isStatus ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            ) : (
              <CcRewardLogo size={16} />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              {sectionLabel}
            </p>
            <p className="mt-0.5 text-sm font-semibold leading-snug text-[var(--foreground)]">
              {slotsLabel}
            </p>
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
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
        <p className="mt-3 text-xs text-orange-300">
          <Link href="/wallet" className="font-semibold underline underline-offset-2">
            Create your wallet
          </Link>{" "}
          first to claim on Canton.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-3 whitespace-pre-line rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
          {success}
        </p>
      ) : null}
    </section>
  );
}
