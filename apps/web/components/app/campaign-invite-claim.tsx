"use client";

import Link from "next/link";
import { useState } from "react";
import { Ticket, Sparkles } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CampaignMeta } from "@/lib/campaign-reward";

const CLAIM_FAIL_MSG =
  "Claim failed: Transaction reverted by ledger (Slot is full or insufficient balance)";

export function CampaignInviteClaimSection({
  questId,
  partyId,
  campaignMeta,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  campaignMeta: CampaignMeta;
  onClaimed: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fee = campaignMeta.fcfsClaimFeeCc;
  const codes = campaignMeta.codesRemaining ?? 0;

  async function handleClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/quests/${questId}/claim-invite`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        inviteCode?: string;
      };
      if (!res.ok || data.ok === false) {
        setError(
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : CLAIM_FAIL_MSG,
        );
        return;
      }
      setSuccess(data.message ?? (data.inviteCode ? `Code: ${data.inviteCode}` : "Claimed."));
      onClaimed();
    } catch {
      setError(CLAIM_FAIL_MSG);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-violet-500/40 bg-gradient-to-br from-violet-500/15 via-[var(--card)] to-[var(--card)] p-6 md:p-8">
      <div className="relative text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-200">
          <Sparkles className="h-3.5 w-3.5" />
          Claim code
        </span>
        <h4 className="mt-4 text-lg font-semibold">Claim your voucher</h4>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
          {codes > 0
            ? `${codes} code(s) in pool. Pay ${fee} CC claim fee on-chain to reveal your code.`
            : "No codes left in the pool."}
        </p>
        <button
          type="button"
          disabled={isSubmitting || !partyId || codes <= 0}
          onClick={() => void handleClaim()}
          className={cn(
            buttonVariants({ size: "lg" }),
            "mt-8 w-full max-w-sm gap-2 rounded-full py-6 text-base font-bold",
          )}
        >
          {isSubmitting ? (
            <LoadingSpinner size="lg" />
          ) : (
            <Ticket className="h-5 w-5" />
          )}
          {isSubmitting ? "Claiming…" : `Claim code (${fee} CC fee)`}
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
