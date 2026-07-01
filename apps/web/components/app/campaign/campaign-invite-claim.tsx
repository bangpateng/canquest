"use client";

import { useState } from "react";
import { formatFcfsClaimFeeHint } from "@/lib/canton/campaign-reward";
import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { launchClaimConfetti } from "@/components/ui/confetti-effect";
import { FCFS_CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
import { usePlatformT } from "@/lib/i18n/platform-provider";

export function CampaignInviteClaimSection({
  questId,
  partyId,
  campaignMeta,
  rewardType,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  campaignMeta: CampaignMeta;
  rewardType?: string | null;
  onClaimed: () => void;
}) {
  const t = usePlatformT();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [claimedCode, setClaimedCode] = useState<string | null>(null);

  const sectionLabel =
    rewardType === "INVITE_CODE_FCFS"
      ? t("earnCampaigns.kindInvite")
      : t("earnCampaigns.kindRaffle");

  const fee = campaignMeta.fcfsClaimFeeCc;
  const codes = campaignMeta.codesRemaining ?? 0;
  // Hint langsung; tidak perlu hack string.replace (sebelumnya mengganti "receive 0 CC").
  const feeHint = fee > 0
    ? `Pay ${fee} CC claim fee on-chain to reveal your invite code`
    : "Claim your invite code";

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
            : FCFS_CLAIM_FAIL_MSG,
        );
        return;
      }
      const code = data.inviteCode ?? null;
      setClaimedCode(code);
      setSuccess(data.message ?? (code ? `Your code: ${code}` : "Claimed."));
      launchClaimConfetti();
      onClaimed();
    } catch {
      setError(FCFS_CLAIM_FAIL_MSG);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <CampaignFcfsRewardCard
        mode="claim"
        sectionLabel={sectionLabel}
        slotsLabel={codes > 0 ? `${codes} code(s) left` : "No codes left"}
        description={codes > 0 ? feeHint : "No codes left in the pool."}
        rewardCc={0}
        rewardType={rewardType}
        partyId={partyId}
        canClaim={codes > 0}
        isSubmitting={isSubmitting}
        error={error}
        success={success}
        claimButtonLabel="Claim"
        onClaim={() => void handleClaim()}
      />
      {claimedCode && (
        <RewardReveal
          inviteCode={claimedCode}
          rewardType={rewardType}
          redeemUrl={campaignMeta.redeemUrl}
          redeemInstructions={campaignMeta.redeemInstructions}
        />
      )}
    </div>
  );
}
