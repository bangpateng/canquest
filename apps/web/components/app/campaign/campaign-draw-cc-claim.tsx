"use client";

import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import { formatFcfsClaimFeeHint, formatRewardAmount } from "@/lib/canton/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { launchClaimConfetti } from "@/components/ui/confetti-effect";
import { CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
import { normalizeRewardToken, type RewardTokenSymbol } from "@/lib/quest/quest-types";
import { useState } from "react";

/** "Aug 14, 21:39" — compact end date for the claim-details rows. */
function formatEndMeta(endsAt: string | null | undefined): string | null {
  if (!endsAt) return null;
  return new Date(endsAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CampaignDrawCcClaimSection({
  questId,
  partyId,
  rewardCc,
  rewardToken,
  campaignMeta,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  rewardCc: number;
  rewardToken?: RewardTokenSymbol | string | null;
  campaignMeta: CampaignMeta;
  onClaimed: () => void;
}) {
  const token: RewardTokenSymbol = normalizeRewardToken(rewardToken);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deliveryKind, setDeliveryKind] = useState<"direct" | "pending_offer" | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  const fee = campaignMeta.fcfsClaimFeeCc;
  const feeHint = formatFcfsClaimFeeHint(fee, rewardCc, token);

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
        rewardDelivery?: "direct" | "pending_offer";
      };
      if (!res.ok || data.ok === false) {
        setError(
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : CLAIM_FAIL_MSG,
        );
        return;
      }
      setDeliveryKind(data.rewardDelivery ?? null);
      setSuccess(data.message ?? `${formatRewardAmount(rewardCc, token)} sent to your wallet.`);
      launchClaimConfetti(token);
      onClaimed();
    } catch {
      setError(CLAIM_FAIL_MSG);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <CampaignFcfsRewardCard
        mode="claim"
        sectionLabel="Raffle reward"
        slotsLabel={`You won · ${formatRewardAmount(rewardCc, token)}`}
        description={feeHint}
        rewardCc={rewardCc}
        rewardType="CC_MANUAL"
        rewardToken={token}
        deliveryKind={deliveryKind}
        partyId={partyId}
        canClaim
        isSubmitting={isSubmitting}
        error={error}
        success={success}
        claimButtonLabel="Claim"
        onClaim={() => setClaimOpen(true)}
      />

      <ClaimDetailsModal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        heroAmount={formatRewardAmount(rewardCc, token)}
        rewardLabel="Reward · winner"
        tokenHero={token === "USDCx" ? "USDCx" : "CC"}
        rows={[
          {
            label: "Claim fee",
            value: fee > 0 ? `${fee} CC` : "Free",
            accent: fee <= 0,
          },
          { label: "Network", value: "Canton" },
          ...(formatEndMeta(campaignMeta.endsAt)
            ? [{ label: campaignMeta.ended ? "Ended" : "Closes", value: formatEndMeta(campaignMeta.endsAt)! }]
            : []),
        ]}
        eligibleHint="Winner drawn — you're eligible to claim"
        isConfirming={isSubmitting}
        onConfirm={() => {
          setClaimOpen(false);
          void handleClaim();
        }}
      />
    </>
  );
}
