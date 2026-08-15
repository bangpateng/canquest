"use client";

import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import {
  formatFcfsSlotsFilled,
  formatFcfsSlotsRemaining,
  isFcfsSlotsFull,
} from "@/lib/canton/campaign-reward";
import { CampaignClaimCta } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { normalizeRewardToken, type RewardTokenSymbol } from "@/lib/quest/quest-types";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { FCFS_CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
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

export function CampaignFcfsClaimSection({
  questId,
  partyId,
  rewardCc,
  rewardToken,
  campaignMeta,
  questOrg,
  questTitle,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  rewardCc: number;
  rewardToken?: RewardTokenSymbol | string | null;
  campaignMeta: CampaignMeta;
  questOrg?: string | null;
  questTitle?: string | null;
  onClaimed: () => void;
}) {
  const token: RewardTokenSymbol = normalizeRewardToken(rewardToken);
  const tx = useTransactionStatus();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deliveryKind, setDeliveryKind] = useState<"direct" | "pending_offer" | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  const remaining = campaignMeta.remainingSlots ?? 0;
  const maxWinners = campaignMeta.maxWinners;
  const fee = campaignMeta.fcfsClaimFeeCc;
  const canClaim = remaining > 0 && maxWinners != null && maxWinners > 0;
  const slotsFull = isFcfsSlotsFull(remaining, maxWinners);
  const feeLabel = fee > 0 ? `${fee} CC` : "Free";
  const isUsdcx = token === "USDCx";
  const subtitle = [questOrg, questTitle].filter(Boolean).join(" · ") || undefined;

  async function handleFCFSClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    // Mockup claim flow: tx-status modal (broadcast → confirmed), no confetti.
    tx.start({
      title: "Reward claimed",
      subtitle,
      amountText: `+${rewardCc} ${token}`,
      subText: subtitle,
      accentBg: isUsdcx ? "bg-sky-500/15" : "bg-canton-subtle",
      accentText: isUsdcx ? "text-sky-300" : "text-canton",
      meta: [{ label: "Claim fee paid", value: feeLabel }],
    });
    tx.broadcast();

    try {
      const res = await fetch(`/api/quests/${questId}/claim-fcfs`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        remainingSlots?: number;
        rewardDelivery?: "direct" | "pending_offer";
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
      const afterRemaining =
        data.remainingSlots ?? Math.max(0, remaining - 1);
      const delivery = data.rewardDelivery ?? null;
      setDeliveryKind(delivery);
      setSuccess(
        `${formatFcfsSlotsRemaining(afterRemaining, maxWinners)}\nReward: +${rewardCc} ${token}${fee > 0 ? ` · fee ${fee} CC` : ""}`,
      );
      tx.succeed({
        meta: [
          { label: "Claim fee paid", value: feeLabel },
          ...(delivery
            ? [{
                label: "Delivery",
                value: delivery === "direct" ? "Sent to wallet" : "Accept in wallet inbox",
              }]
            : []),
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
    <>
      {/* Cukup tombol Claim — rincian (fee/slots/reward) ada di modal. */}
      <CampaignClaimCta
        label={canClaim ? "Claim" : "Checking slot availability…"}
        disabled={!canClaim}
        isSubmitting={isSubmitting}
        needsWallet={!partyId}
        error={error}
        success={success}
        deliveryKind={deliveryKind}
        onClaim={() => setClaimOpen(true)}
      />

      <ClaimDetailsModal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        heroValue={String(rewardCc)}
        heroUnit={token}
        rewardLabel="Reward"
        tokenHero={isUsdcx ? "USDCx" : "CC"}
        rows={[
          { label: "Claim fee", value: feeLabel, accent: fee <= 0 },
          {
            label: "Slots",
            value: slotsFull ? "Full Claimed" : formatFcfsSlotsFilled(remaining, maxWinners),
            tag: !slotsFull ? `${remaining} left` : undefined,
          },
          { label: "Network", value: "Canton", dot: true },
          ...(formatEndMeta(campaignMeta.endsAt)
            ? [{ label: campaignMeta.ended ? "Ended" : "Closes", value: formatEndMeta(campaignMeta.endsAt)! }]
            : []),
        ]}
        eligibleHint="All milestones completed — you're eligible"
        isConfirming={isSubmitting}
        onConfirm={() => {
          setClaimOpen(false);
          void handleFCFSClaim();
        }}
      />
    </>
  );
}
