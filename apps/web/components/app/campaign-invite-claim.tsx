"use client";

import { useState } from "react";
import { formatFcfsClaimFeeHint } from "@/lib/campaign-reward";
import type { CampaignMeta } from "@/lib/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign-fcfs-reward-card";
import { usePlatformT } from "@/lib/i18n/platform-provider";

const CLAIM_FAIL_MSG =
  "Claim failed: Transaction reverted by ledger (Slot is full or insufficient balance)";

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

  const sectionLabel =
    rewardType === "INVITE_CODE_FCFS"
      ? t("earnCampaigns.kindInvite")
      : t("earnCampaigns.kindRaffle");

  const fee = campaignMeta.fcfsClaimFeeCc;
  const codes = campaignMeta.codesRemaining ?? 0;
  const feeHint = formatFcfsClaimFeeHint(fee, 0).replace("receive 0 CC from the pool", "reveal your code");

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
    <CampaignFcfsRewardCard
      mode="claim"
      sectionLabel={sectionLabel}
      slotsLabel={codes > 0 ? `${codes} code(s) left` : "No codes left"}
      description={codes > 0 ? feeHint : "No codes left in the pool."}
      rewardCc={0}
      partyId={partyId}
      canClaim={codes > 0}
      isSubmitting={isSubmitting}
      error={error}
      success={success}
      claimButtonLabel="Claim"
      onClaim={() => void handleClaim()}
    />
  );
}
