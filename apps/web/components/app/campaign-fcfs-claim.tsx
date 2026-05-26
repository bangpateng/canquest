"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CampaignMeta } from "@/lib/campaign-reward";
import {
  formatFcfsClaimFeeHint,
  formatFcfsSlotsFilled,
  formatFcfsSlotsRemaining,
} from "@/lib/campaign-reward";
import { Rocket, Sparkles } from "lucide-react";
import { useState } from "react";

const FCFS_FAIL_MSG =
  "Claim failed: Transaction reverted by ledger (Slot is full or insufficient balance)";

export function CampaignFcfsClaimSection({
  questId,
  partyId,
  rewardCc,
  campaignMeta,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  rewardCc: number;
  campaignMeta: CampaignMeta;
  onClaimed: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const remaining = campaignMeta.remainingSlots ?? 0;
  const maxWinners = campaignMeta.maxWinners;
  const fee = campaignMeta.fcfsClaimFeeCc;
  const slotsLabel =
    remaining > 0
      ? formatFcfsSlotsRemaining(remaining, maxWinners)
      : formatFcfsSlotsFilled(remaining, maxWinners, "Ended");
  const feeHint = formatFcfsClaimFeeHint(fee, rewardCc);

  async function handleFCFSClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/quests/${questId}/claim-fcfs`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        remainingSlots?: number;
      };
      if (!res.ok || data.ok === false) {
        setError(
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : FCFS_FAIL_MSG,
        );
        return;
      }
      const afterRemaining =
        data.remainingSlots ?? Math.max(0, remaining - 1);
      setSuccess(
        `${formatFcfsSlotsRemaining(afterRemaining, maxWinners)}\n${feeHint}`,
      );
      onClaimed();
    } catch {
      setError(FCFS_FAIL_MSG);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--primary)]/40 bg-gradient-to-br from-[var(--primary)]/15 via-[var(--card)] to-[var(--card)] p-6 md:p-8">
      <div className="relative text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-canton">
          <Sparkles className="h-3.5 w-3.5" />
          FCFS reward
        </span>
        <p className="mx-auto mt-4 max-w-md text-sm text-[var(--foreground)]">
          {remaining > 0 && maxWinners ? (
            <>
              <span className="block text-base font-semibold">{slotsLabel}</span>
              <span className="mt-2 block text-[var(--muted-foreground)]">
                {feeHint}
              </span>
            </>
          ) : (
            <span className="text-[var(--muted-foreground)]">
              Checking slot availability…
            </span>
          )}
        </p>

        <button
          type="button"
          disabled={isSubmitting || !partyId || remaining <= 0}
          onClick={() => void handleFCFSClaim()}
          className={cn(
            buttonVariants({ size: "lg" }),
            "mt-8 w-full max-w-sm gap-2 rounded-full py-6 text-base font-bold",
          )}
        >
          {isSubmitting ? (
            <LoadingSpinner size="lg" />
          ) : (
            <Rocket className="h-5 w-5" />
          )}
          {isSubmitting ? "Claiming…" : `Claim ${rewardCc} CC`}
        </button>

        {!partyId ? (
          <p className="mt-4 text-xs text-orange-300">
            <Link href="/wallet" className="font-semibold underline underline-offset-2">
              Create your wallet
            </Link>{" "}
            first to claim on Canton.
          </p>
        ) : null}

        {error ? (
          <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-300">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="mx-auto mt-4 max-w-md whitespace-pre-line rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}
