"use client";

import Link from "next/link";
import { useState } from "react";
import { Coins, Sparkles } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CampaignMeta } from "@/lib/campaign-reward";
import { formatFcfsClaimFeeHint } from "@/lib/campaign-reward";

const CLAIM_FAIL_MSG =
  "Claim failed: Transaction reverted by ledger (insufficient balance or network error)";

export function CampaignDrawCcClaimSection({
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

  const fee = campaignMeta.fcfsClaimFeeCc;
  const feeHint = formatFcfsClaimFeeHint(fee, rewardCc);

  async function handleClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/quests/${questId}/claim-draw-cc`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!res.ok || data.ok === false) {
        setError(
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : CLAIM_FAIL_MSG,
        );
        return;
      }
      setSuccess(data.message ?? `${rewardCc} CC sent to your wallet.`);
      onClaimed();
    } catch {
      setError(CLAIM_FAIL_MSG);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-[var(--card)] to-[var(--card)] p-6 md:p-8">
      <div className="relative text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
          <Sparkles className="h-3.5 w-3.5" />
          You won!
        </span>
        <h4 className="mt-4 text-lg font-semibold">Claim your CC reward</h4>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
          {feeHint}
        </p>
        <button
          type="button"
          disabled={isSubmitting || !partyId}
          onClick={() => void handleClaim()}
          className={cn(
            buttonVariants({ size: "lg" }),
            "mt-8 w-full max-w-sm gap-2 rounded-full py-6 text-base font-bold",
          )}
        >
          {isSubmitting ? (
            <LoadingSpinner size="lg" />
          ) : (
            <Coins className="h-5 w-5" />
          )}
          {isSubmitting ? "Claiming…" : `Claim ${rewardCc} CC (${fee} CC fee)`}
        </button>
        {!partyId ? (
          <p className="mt-4 text-xs text-orange-300">
            <Link href="/wallet" className="font-semibold underline underline-offset-2">
              Create your wallet
            </Link>{" "}
            first to pay the claim fee on Canton.
          </p>
        ) : null}
        {error ? (
          <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-300">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mx-auto mt-4 max-w-md rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-300">
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}
