"use client";

import { useState } from "react";
import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import { formatRewardAmount } from "@/lib/canton/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { launchClaimConfetti } from "@/components/ui/confetti-effect";
import { CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
import { normalizeRewardToken, type RewardTokenSymbol } from "@/lib/quest/quest-types";

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

/**
 * CC + Code Combined Raffle Claim Section
 *
 * Shown when rewardType === "CC_AND_CODE_RAFFLE" and user is a raffle winner.
 * Winner pays 5 CC claim fee → receives reward (CC or USDCx) + invite code in one transaction.
 */
export function CampaignCcAndCodeRaffleClaimSection({
  questId,
  partyId,
  rewardCc,
  rewardVariant,
  rewardToken,
  campaignMeta,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  rewardCc: number;
  rewardVariant: "CODE" | "CC" | null;
  rewardToken?: RewardTokenSymbol | string | null;
  campaignMeta: CampaignMeta;
  onClaimed: () => void;
}) {
  const token: RewardTokenSymbol = normalizeRewardToken(rewardToken);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [claimedCode, setClaimedCode] = useState<string | null>(null);
  const [deliveryKind, setDeliveryKind] = useState<"direct" | "pending_offer" | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  const fee = campaignMeta.fcfsClaimFeeCc;

  async function handleClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/quests/${questId}/claim-cc-and-code-raffle`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        inviteCode?: string;
        rewardCc?: number;
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
      const code = data.inviteCode ?? null;
      setClaimedCode(code);
      setDeliveryKind(data.rewardDelivery ?? null);
      setSuccess(
        data.message ??
          (code
            ? `${formatRewardAmount(rewardCc, token)} sent to your wallet! Your code: ${code}`
            : `${formatRewardAmount(rewardCc, token)} sent to your wallet.`),
      );
      launchClaimConfetti(token);
      onClaimed();
    } catch {
      setError(CLAIM_FAIL_MSG);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Label menyesuaikan varian pemenang.
  const isCodeOnly = rewardVariant === "CODE";
  const isCcOnly = rewardVariant === "CC";
  const wonLabel = isCodeOnly
    ? "You won · Code"
    : isCcOnly
      ? `You won · ${formatRewardAmount(rewardCc, token)}`
      : `You won · ${formatRewardAmount(rewardCc, token)} + Code`;
  const claimLabel = isCodeOnly
    ? "Claim your Code"
    : isCcOnly
      ? `Claim ${formatRewardAmount(rewardCc, token)}`
      : `Claim ${formatRewardAmount(rewardCc, token)} + Code`;
  const description = isCodeOnly
    ? fee > 0
      ? `Pay ${fee} CC claim fee on-chain to reveal your invite code`
      : "Claim your invite code"
    : isCcOnly
      ? fee > 0
        ? `Pay ${fee} CC claim fee on-chain to receive ${formatRewardAmount(rewardCc, token)}`
        : `Claim your ${formatRewardAmount(rewardCc, token)} reward`
      : fee > 0
        ? `Pay ${fee} CC claim fee on-chain to receive ${formatRewardAmount(rewardCc, token)} + your invite code`
        : `Claim your ${formatRewardAmount(rewardCc, token)} reward and invite code`;

  return (
    <div className="space-y-3">
      <CampaignFcfsRewardCard
        mode="claim"
        sectionLabel="Token + Code Raffle reward"
        slotsLabel={wonLabel}
        description={description}
        rewardCc={rewardCc}
        rewardType="CC_AND_CODE_RAFFLE"
        rewardToken={token}
        deliveryKind={deliveryKind}
        partyId={partyId}
        canClaim
        isSubmitting={isSubmitting}
        error={error}
        success={success}
        claimButtonLabel={claimLabel}
        onClaim={() => setClaimOpen(true)}
      />

      <ClaimDetailsModal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        heroAmount={
          isCodeOnly
            ? "1 invite code"
            : `${formatRewardAmount(rewardCc, token)} + 1 Code`
        }
        rewardLabel="Reward · winner"
        tokenHero={isCodeOnly ? undefined : token === "USDCx" ? "USDCx" : "CC"}
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

      {claimedCode && (
        <RewardReveal
          inviteCode={claimedCode}
          rewardCc={rewardVariant === "CC" ? 0 : rewardCc}
          rewardType="CC_AND_CODE_RAFFLE"
          rewardToken={token}
          redeemUrl={campaignMeta.redeemUrl}
          redeemInstructions={campaignMeta.redeemInstructions}
        />
      )}
    </div>
  );
}
