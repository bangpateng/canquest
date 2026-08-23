"use client";

import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import {
  formatEndMeta,
  formatRewardAmount,
} from "@/lib/canton/campaign-reward";
import { CampaignClaimCta } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { CampaignStatusRow } from "@/components/app/campaign/campaign-status-row";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { TokenUsdValue } from "@/components/app/earn/cc-usd-value";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
import { normalizeRewardToken, type RewardTokenSymbol } from "@/lib/quest/quest-types";
import { Trophy } from "lucide-react";
import { useState } from "react";

export function CampaignDrawCcClaimSection({
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

  const fee = campaignMeta.fcfsClaimFeeCc;
  const feeLabel = fee > 0 ? `${fee} CC` : "Free";
  const isUsdcx = token === "USDCx";
  const subtitle = [questOrg, questTitle].filter(Boolean).join(" · ") || undefined;

  async function handleClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    // Mockup claim flow: tx-status modal (broadcast → confirmed), no confetti.
    tx.start({
      title: "Reward claimed",
      subtitle,
      amountText: `+${formatRewardAmount(rewardCc, token)}`,
      usdAmount: rewardCc > 0 ? { amount: rewardCc, token } : null,
      subText: subtitle,
      accentBg: isUsdcx ? "bg-sky-500/15" : "bg-canton-subtle",
      accentText: isUsdcx ? "text-sky-600" : "text-canton",
      meta: [{ label: "Claim fee paid", value: feeLabel }],
    });
    tx.broadcast();

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
        tx.dismiss();
        setError(
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : CLAIM_FAIL_MSG,
        );
        return;
      }
      const delivery = data.rewardDelivery ?? null;
      setDeliveryKind(delivery);
      setSuccess(data.message ?? `${formatRewardAmount(rewardCc, token)} sent to your wallet.`);
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
      setError(CLAIM_FAIL_MSG);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Baris WIN (state fcfs_claimable) — pemenang ditarik admin, belum claim. */}
      <CampaignStatusRow tone="emerald" icon={Trophy} strokeWidth={2.4} label="Raffle Result">
        You won · claim your reward below
      </CampaignStatusRow>

      {/* Cukup tombol Claim — rincian (fee/reward) ada di modal. */}
      <CampaignClaimCta
        label={`Claim ${formatRewardAmount(rewardCc, token)}`}
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
        heroUsd={rewardCc > 0 ? <TokenUsdValue amount={rewardCc} token={token} /> : undefined}
        rewardLabel="Reward · winner"
        tokenHero={isUsdcx ? "USDCx" : "CC"}
        rows={[
          { label: "Claim fee", value: feeLabel, accent: fee <= 0 },
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
    </div>
  );
}
