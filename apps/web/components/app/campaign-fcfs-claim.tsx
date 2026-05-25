"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CampaignMeta } from "@/lib/campaign-reward";
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

  const slots = campaignMeta.remainingSlots ?? 0;
  const fee = campaignMeta.fcfsClaimFeeCc;

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
      };
      if (!res.ok || data.ok === false) {
        setError(
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : FCFS_FAIL_MSG,
        );
        return;
      }
      setSuccess(data.message ?? `${rewardCc} CC claimed successfully.`);
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
        <h4 className="mt-4 text-lg font-semibold">Claim your CC</h4>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
          {slots > 0
            ? `${slots} slot(s) remaining. Pay ${fee} CC claim fee on-chain to receive ${rewardCc} CC from the pool.`
            : "Checking slot availability…"}
        </p>

        <button
          type="button"
          disabled={isSubmitting || !partyId || slots <= 0}
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
          <p className="mx-auto mt-4 max-w-md rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-300">
            {success}
          </p>
        ) : null}
      </div>
    </section>
  );
}
