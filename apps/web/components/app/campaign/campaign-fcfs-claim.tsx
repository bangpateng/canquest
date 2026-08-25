"use client";

import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import {
  formatEndMeta,
  formatFcfsSlotsFilled,
  formatFcfsSlotsRemaining,
  isFcfsSlotsFull,
} from "@/lib/canton/campaign-reward";
import { CampaignClaimCta } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { TokenUsdValue } from "@/components/app/earn/cc-usd-value";
import { normalizeRewardToken, type RewardTokenSymbol } from "@/lib/quest/quest-types";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { FCFS_CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
import { useMe } from "@/lib/hooks/use-me";
import { signRelayPrepared } from "@/lib/wallet/sign-relay";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";
import { useState } from "react";

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
  // M3b: user external → claim fee di-sign di browser sebelum klaim.
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === "external";
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();
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
      usdAmount: rewardCc > 0 ? { amount: rewardCc, token } : null,
      subText: subtitle,
      accentBg: isUsdcx ? "bg-sky-500/15" : "bg-canton-subtle",
      accentText: isUsdcx ? "text-sky-600" : "text-canton",
      meta: [{ label: "Claim fee paid", value: feeLabel }],
    });

    try {
      // ── M3b: user EXTERNAL — bayar claim fee via tanda tangan browser ──
      // (prepare-external → sign hash → execute). Modal menunggu di tahap
      // 'sign' sampai signature diterima.
      let externalFeeTxId: string | undefined;
      if (isExternalWallet && fee > 0) {
        const prep = await fetch(
          `/api/quests/${questId}/claim-fcfs/prepare-external`,
          { method: "POST", credentials: "include" },
        );
        const prepRaw = (await prep.json().catch(() => null)) as {
          hash?: string;
          description?: string;
          message?: string;
        } | null;
        if (!prep.ok || !prepRaw?.hash) {
          tx.dismiss();
          setError(prepRaw?.message ?? FCFS_CLAIM_FAIL_MSG);
          return;
        }
        try {
          const signed = await signRelayPrepared(
            { hash: prepRaw.hash, description: prepRaw.description },
            {
              onWalletLocked: () =>
                promptPassphrase(
                  `Claim fee ${fee} CC${subtitle ? ` — ${subtitle}` : ""}`,
                ),
            },
          );
          externalFeeTxId = signed.updateId;
        } catch (err) {
          tx.dismiss();
          setError(
            err instanceof Error && err.message
              ? err.message
              : FCFS_CLAIM_FAIL_MSG,
          );
          return;
        }
      }
      tx.broadcast();

      const res = await fetch(`/api/quests/${questId}/claim-fcfs`, {
        method: "POST",
        credentials: "include",
        ...(externalFeeTxId
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ externalFeeTxId }),
            }
          : {}),
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
      {/* M3b: prompt passphrase claim fee (user external). */}
      {passphraseModal}
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
        heroUsd={rewardCc > 0 ? <TokenUsdValue amount={rewardCc} token={token} /> : undefined}
        rewardLabel="Reward"
        tokenHero={isUsdcx ? "USDCx" : "CC"}
        rows={[
          { label: "Claim fee", value: feeLabel, accent: fee <= 0 },
          {
            label: "Slots",
            value: slotsFull ? "Full Claimed" : formatFcfsSlotsFilled(remaining, maxWinners),
            tag: !slotsFull ? `${remaining} left` : undefined,
          },
          { label: "Network", value: "Canton" },
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
