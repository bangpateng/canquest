"use client";

import { useState } from "react";
import { formatEndMeta } from "@/lib/canton/campaign-reward";
import type { CampaignMeta } from "@/lib/canton/campaign-reward";
import { CampaignClaimCta } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { CampaignStatusRow } from "@/components/app/campaign/campaign-status-row";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { FCFS_CLAIM_FAIL_MSG } from "@/lib/campaign/claim-messages";
import { useExternalClaimFee } from "@/lib/wallet/use-external-claim-fee";
import { Trophy } from "lucide-react";

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
  const tx = useTransactionStatus();
  // M3b: user external → claim fee di-sign di browser (semua tipe campaign).
  const { signClaimFee, passphraseModal } = useExternalClaimFee();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [claimedCode, setClaimedCode] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  const fee = campaignMeta.fcfsClaimFeeCc;
  const feeLabel = fee > 0 ? `${fee} CC` : "Free";
  const codes = campaignMeta.codesRemaining ?? 0;
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
      accentText: "text-violet-600",
      meta: [{ label: "Claim fee paid", value: feeLabel }],
    });
    tx.broadcast();

    try {
      // ── M3b: user EXTERNAL — bayar claim fee via tanda tangan browser ──
      let externalFeeTxId: string | undefined;
      try {
        externalFeeTxId = await signClaimFee(
          questId,
          'invite',
          fee,
          `Claim fee ${fee} CC${subtitle ? ` — ${subtitle}` : ''}`,
        );
      } catch (err) {
        tx.dismiss();
        setError(
          err instanceof Error && err.message
            ? err.message
            : FCFS_CLAIM_FAIL_MSG,
        );
        return;
      }
      tx.broadcast();

      const res = await fetch(`/api/quests/${questId}/claim-invite`, {
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
      {/* M3b: prompt passphrase claim fee (user external). */}
      {passphraseModal}
      {/* Baris WIN untuk code raffle (INVITE_CODE_RANDOM); FCFS code tidak
          menampilkan baris ini (bukan undian). */}
      {rewardType === "INVITE_CODE_RANDOM" ? (
        <CampaignStatusRow tone="emerald" icon={Trophy} strokeWidth={2.4} label="Code Raffle">
          You won · claim your invite code below
        </CampaignStatusRow>
      ) : null}

      {/* Cukup tombol Claim — rincian (fee/codes) ada di modal. */}
      <CampaignClaimCta
        label={codes > 0 ? "Claim" : "No codes left"}
        disabled={codes <= 0}
        isSubmitting={isSubmitting}
        needsWallet={!partyId}
        error={error}
        success={success}
        onClaim={() => setClaimOpen(true)}
      />

      <ClaimDetailsModal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        heroValue="1"
        heroUnit="invite code"
        rewardLabel="Reward"
        tokenHero="CODE"
        rows={[
          { label: "Claim fee", value: feeLabel, accent: fee <= 0 },
          {
            label: "Codes",
            value: codes > 0 ? `${codes} left` : "None",
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
