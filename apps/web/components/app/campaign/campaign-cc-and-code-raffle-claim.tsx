"use client";

import { useState } from "react";
import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { launchClaimConfetti } from "@/components/ui/confetti-effect";
import { CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";

/**
 * CC + Code Combined Raffle Claim Section
 *
 * Shown when rewardType === "CC_AND_CODE_RAFFLE" and user is a raffle winner.
 * Winner pays 5 CC claim fee → receives CC reward + invite code in one transaction.
 */
export function CampaignCcAndCodeRaffleClaimSection({
  questId,
  partyId,
  rewardCc,
  rewardVariant,
  campaignMeta,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  rewardCc: number;
  rewardVariant: "CODE" | "CC" | null;
  campaignMeta: CampaignMeta;
  onClaimed: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [claimedCode, setClaimedCode] = useState<string | null>(null);

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
      setSuccess(
        data.message ??
          (code
            ? `${rewardCc} CC sent to your wallet! Your code: ${code}`
            : `${rewardCc} CC sent to your wallet.`),
      );
      launchClaimConfetti();
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
      ? `You won · ${rewardCc} CC`
      : `You won · ${rewardCc} CC + Code`;
  const claimLabel = isCodeOnly
    ? "Claim your Code"
    : isCcOnly
      ? `Claim ${rewardCc} CC`
      : `Claim ${rewardCc} CC + Code`;
  const description = isCodeOnly
    ? fee > 0
      ? `Pay ${fee} CC claim fee on-chain to reveal your invite code`
      : "Claim your invite code"
    : isCcOnly
      ? fee > 0
        ? `Pay ${fee} CC claim fee on-chain to receive ${rewardCc} CC`
        : `Claim your ${rewardCc} CC reward`
      : fee > 0
        ? `Pay ${fee} CC claim fee on-chain to receive ${rewardCc} CC + your invite code`
        : `Claim your ${rewardCc} CC reward and invite code`;

  return (
    <div className="space-y-3">
      <CampaignFcfsRewardCard
        mode="claim"
        sectionLabel="CC + Code Raffle reward"
        slotsLabel={wonLabel}
        description={description}
        rewardCc={rewardCc}
        partyId={partyId}
        canClaim
        isSubmitting={isSubmitting}
        error={error}
        success={success}
        claimButtonLabel={claimLabel}
        onClaim={() => void handleClaim()}
      />
      {claimedCode && (
        <RewardReveal inviteCode={claimedCode} rewardCc={rewardVariant === "CC" ? 0 : rewardCc} />
      )}
    </div>
  );
}
