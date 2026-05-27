"use client";

import type { CampaignMeta } from "@/lib/campaign-reward";
import { formatFcfsClaimFeeHint } from "@/lib/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign-fcfs-reward-card";
import { useState } from "react";

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
    <CampaignFcfsRewardCard
      mode="claim"
      sectionLabel="Raffle reward"
      slotsLabel={`You won · ${rewardCc} CC`}
      description={feeHint}
      rewardCc={rewardCc}
      partyId={partyId}
      canClaim
      isSubmitting={isSubmitting}
      error={error}
      success={success}
      claimButtonLabel="Claim"
      onClaim={() => void handleClaim()}
    />
  );
}
