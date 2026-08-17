"use client";

import { useState } from "react";
import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import {
  formatEndMeta,
  formatRewardAmount,
} from "@/lib/canton/campaign-reward";
import { CampaignClaimCta } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { CampaignStatusRow } from "@/components/app/campaign/campaign-status-row";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { TokenUsdValue } from "@/components/app/earn/cc-usd-value";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
import { normalizeRewardToken, type RewardTokenSymbol } from "@/lib/quest/quest-types";
import { Trophy } from "lucide-react";

/**
 * CC + Code Combined Raffle Claim Section
 *
 * Shown when rewardType === "CC_AND_CODE_RAFFLE" and user is a raffle winner.
 * Winner pays 5 CC fee → receives reward (CC or USDCx) + invite code in one transaction.
 */
export function CampaignCcAndCodeRaffleClaimSection({
  questId,
  partyId,
  rewardCc,
  rewardVariant,
  rewardToken,
  campaignMeta,
  questOrg,
  questTitle,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  rewardCc: number;
  rewardVariant: "CODE" | "CC" | null;
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
  const [claimedCode, setClaimedCode] = useState<string | null>(null);
  const [deliveryKind, setDeliveryKind] = useState<"direct" | "pending_offer" | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  const fee = campaignMeta.fcfsClaimFeeCc;
  const feeLabel = fee > 0 ? `${fee} CC` : "Free";
  const isCodeOnly = rewardVariant === "CODE";
  const isUsdcx = token === "USDCx";
  const subtitle = [questOrg, questTitle].filter(Boolean).join(" · ") || undefined;
  const claimLabel = isCodeOnly
    ? "Claim your Code"
    : rewardVariant === "CC"
      ? `Claim ${formatRewardAmount(rewardCc, token)}`
      : `Claim ${formatRewardAmount(rewardCc, token)} + Code`;

  async function handleClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    // Mockup claim flow: tx-status modal (broadcast → confirmed), no confetti.
    tx.start({
      title: isCodeOnly ? "Invite code claimed" : "Reward claimed",
      subtitle,
      amountText: isCodeOnly
        ? "1 invite code"
        : `+${formatRewardAmount(rewardCc, token)} + 1 Code`,
      usdAmount: !isCodeOnly && rewardCc > 0 ? { amount: rewardCc, token } : null,
      subText: subtitle,
      accentBg: isUsdcx ? "bg-sky-500/15" : "bg-canton-subtle",
      accentText: isCodeOnly ? "text-violet-300" : isUsdcx ? "text-sky-300" : "text-canton",
      meta: [{ label: "Claim fee paid", value: feeLabel }],
    });
    tx.broadcast();

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
        tx.dismiss();
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
      tx.succeed({
        meta: [
          { label: "Claim fee paid", value: feeLabel },
          ...(data.rewardDelivery
            ? [{
                label: "Delivery",
                value: data.rewardDelivery === "direct" ? "Sent to wallet" : "Accept in wallet inbox",
              }]
            : []),
          ...(code ? [{ label: "Your code", value: code, mono: true }] : []),
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
      <CampaignStatusRow tone="emerald" icon={Trophy} strokeWidth={2.4} label="CC + Code Raffle">
        You won · claim your token + code below
      </CampaignStatusRow>

      {/* Cukup tombol Claim — rincian (fee/reward) ada di modal. */}
      <CampaignClaimCta
        label={claimLabel}
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
        heroValue={isCodeOnly ? "1" : String(rewardCc)}
        heroUnit={isCodeOnly ? "invite code" : `${token} + 1 Code`}
        heroUsd={
          !isCodeOnly && rewardCc > 0 ? (
            <TokenUsdValue amount={rewardCc} token={token} />
          ) : undefined
        }
        rewardLabel="Reward · winner"
        tokenHero={isCodeOnly ? "CODE" : isUsdcx ? "USDCx" : "CC"}
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
