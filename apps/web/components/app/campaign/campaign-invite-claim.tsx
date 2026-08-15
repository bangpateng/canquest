"use client";

import { useState } from "react";
import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { FCFS_CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
import { usePlatformT } from "@/lib/i18n/platform-provider";

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

export function CampaignInviteClaimSection({
  questId,
  partyId,
  campaignMeta,
  rewardType,
  questOrg,
  questTitle,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  campaignMeta: CampaignMeta;
  rewardType?: string | null;
  questOrg?: string | null;
  questTitle?: string | null;
  onClaimed: () => void;
}) {
  const t = usePlatformT();
  const tx = useTransactionStatus();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [claimedCode, setClaimedCode] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  const sectionLabel =
    rewardType === "INVITE_CODE_FCFS"
      ? t("earnCampaigns.kindInvite")
      : t("earnCampaigns.kindRaffle");

  const fee = campaignMeta.fcfsClaimFeeCc;
  const feeLabel = fee > 0 ? `${fee} CC` : "Free";
  const codes = campaignMeta.codesRemaining ?? 0;
  // Hint langsung; tidak perlu hack string.replace (sebelumnya mengganti "receive 0 CC").
  const feeHint = fee > 0
    ? `Pay ${fee} CC claim fee on-chain to reveal your invite code`
    : "Claim your invite code";
  const subtitle = [questOrg, questTitle].filter(Boolean).join(" · ") || undefined;

  async function handleClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    // Mockup claim flow: tx-status modal (broadcast → confirmed), no confetti.
    tx.start({
      title: "Invite code claimed",
      subtitle,
      amountText: "1 invite code",
      subText: subtitle,
      accentBg: "bg-violet-500/15",
      accentText: "text-violet-300",
      meta: [{ label: "Claim fee paid", value: feeLabel }],
    });
    tx.broadcast();

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
        tx.dismiss();
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
      tx.succeed({
        meta: [
          { label: "Claim fee paid", value: feeLabel },
          ...(code ? [{ label: "Your code", value: code, mono: true }] : []),
        ],
      });
      onClaimed();
    } catch {
      tx.dismiss();
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
        onClaim={() => setClaimOpen(true)}
      />

      <ClaimDetailsModal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        heroAmount="1 invite code"
        rewardLabel="Reward"
        rows={[
          { label: "Claim fee", value: feeLabel, accent: fee <= 0 },
          { label: "Codes left", value: codes > 0 ? String(codes) : "—" },
          { label: "Network", value: "Canton" },
          ...(formatEndMeta(campaignMeta.endsAt)
            ? [{ label: campaignMeta.ended ? "Ended" : "Closes", value: formatEndMeta(campaignMeta.endsAt)! }]
            : []),
        ]}
        eligibleHint="All milestones completed — you're eligible"
        isConfirming={isSubmitting}
        onConfirm={() => {
          setClaimOpen(false);
          void handleClaim();
        }}
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
