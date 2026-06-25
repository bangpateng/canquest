"use client";

import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import {
  formatFcfsClaimFeeHint,
  formatFcfsSlotsFilled,
  formatFcfsSlotsRemaining,
} from "@/lib/canton/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { useState } from "react";
import { launchClaimConfetti } from "@/components/ui/confetti-effect";
import { FCFS_CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";

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
  const canClaim = remaining > 0 && maxWinners != null && maxWinners > 0;
  const slotsLabel =
    remaining > 0
      ? formatFcfsSlotsRemaining(remaining, maxWinners)
      : formatFcfsSlotsFilled(remaining, maxWinners, "Full Claimed");
  const feeHint = canClaim ? formatFcfsClaimFeeHint(fee, rewardCc) : null;

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
            : FCFS_CLAIM_FAIL_MSG,
        );
        return;
      }
      const afterRemaining =
        data.remainingSlots ?? Math.max(0, remaining - 1);
      setSuccess(
        `${formatFcfsSlotsRemaining(afterRemaining, maxWinners)}\n${formatFcfsClaimFeeHint(fee, rewardCc)}`,
      );
      launchClaimConfetti();
      onClaimed();
    } catch {
      setError(FCFS_CLAIM_FAIL_MSG);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <CampaignFcfsRewardCard
      mode="claim"
      slotsLabel={canClaim ? slotsLabel : "Checking slot availability…"}
      description={feeHint}
      rewardCc={rewardCc}
      partyId={partyId}
      canClaim={canClaim}
      isSubmitting={isSubmitting}
      error={error}
      success={success}
      onClaim={() => void handleFCFSClaim()}
    />
  );
}
