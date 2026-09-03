"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, Gift, Trophy, Unlock } from "lucide-react";
import Link from "next/link";
import { CampaignClaimCta } from "@/components/app/campaign/campaign-claim-cta";
import { CampaignStatusRow } from "@/components/app/campaign/campaign-status-row";
import { ClaimDetailsModal } from "@/components/app/campaign/claim-details-modal";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { useTransactionStatus } from "@/lib/tx/transaction-status";
import { signRelayPrepared } from "@/lib/wallet/sign-relay";
import { usePassphrasePrompt } from "@/lib/wallet/use-passphrase-prompt";

/**
 * Claim v30 — ClaimOffer → Accept* → ClaimReceipt (paket canquest-claim).
 *
 * UI-STATES.md (aturan keras):
 *   - RewardPending TIDAK PERNAH "Success" — tampil "Check your offers" +
 *     tanggal batas + link ke wallet (reward menunggu diterima di offer menu).
 *   - Pre-check saldo CC bebas & preapproval SEBELUM tombol/tanda tangan.
 *   - Urutan utk pemenang yang CC-nya terkunci: unlock dulu, baru claim.
 *
 * Browser hanya menandatangani HASH (relay) — fee + reward settle atomik
 * on-chain dalam satu transaksi yang disign user.
 */

type V30ClaimStatusResp = {
  v30: true;
  /** Jenis pemenang — FCFS: claim instan pasca-submit; RAFFLE: menunggu draw. */
  selection: 'FCFS' | 'RAFFLE' | 'OFFCHAIN';
  /** User sudah submit tugas campaign ini. */
  submitted: boolean;
  offer: {
    exists: boolean;
    claimStatus: string | null;
    rewardKind: string | null;
    validUntil: string | null;
    expired: boolean;
  };
  /** FCFS: slot diamankan saat submit, menunggu event berakhir. */
  hasSlot: boolean;
  revealedCode: string | null;
  prechecks: {
    freeBalanceCc: number;
    feeCc: number;
    balanceOk: boolean;
    preapprovalActive: boolean;
    preapprovalExpiresAt: string | null;
  };
  uiHint:
    | "CLAIM_READY"
    | "NEED_UNLOCK_OR_TOPUP"
    | "NO_PREAPPROVAL_WARN"
    | "OFFER_EXPIRED"
    | "NOT_DRAWN"
    | "DONE";
};

/**
 * Hitung mundur sisa waktu offer (spesifikasi owner: tampilkan SISA HARI,
 * bukan tanggal). "6 days left" / "9 hours left" / "<1 hour left".
 */
function countdownLeft(validUntil: string | null): string | null {
  if (!validUntil) return null;
  const ms = new Date(validUntil).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""} left`;
  }
  if (hours >= 1) return `${hours} hour${hours > 1 ? "s" : ""} left`;
  return "less than an hour left";
}

export function isV30Quest(quest: { ledgerPackage?: string | null }): boolean {
  return (quest.ledgerPackage ?? "").trim() === "canquest-v30";
}

export function CampaignClaimV30Section({
  questId,
  partyId,
  fcfs,
  rewardType,
  redeemUrl,
  redeemInstructions,
  questOrg,
  questTitle,
  submitted,
  onClaimed,
}: {
  questId: string;
  partyId: string | null;
  /** FCFS = offer dibuat saat prepare (peminang pertama). */
  fcfs?: boolean;
  rewardType?: string | null;
  redeemUrl?: string | null;
  redeemInstructions?: string | null;
  questOrg?: string | null;
  questTitle?: string | null;
  /** Mirror questCompleted dari panel — flip pasca-submit memicu refetch status
   *  supaya tombol Claim FCFS muncul SEKETIKA tanpa refresh manual. */
  submitted: boolean;
  onClaimed: () => void;
}) {
  const tx = useTransactionStatus();
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();
  const [status, setStatus] = useState<V30ClaimStatusResp | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/quests/${questId}/claim-v30/status`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as V30ClaimStatusResp;
      if (data?.v30) setStatus(data);
    } catch {
      /* status refresh best-effort */
    }
  }, [questId]);

  useEffect(() => {
    if (partyId) void loadStatus();
  }, [partyId, submitted, loadStatus]);

  if (!partyId || !status) return null;

  const { offer, prechecks, uiHint } = status;
  const subtitle = [questOrg, questTitle].filter(Boolean).join(" · ") || undefined;
  const fee = prechecks.feeCc;
  const feeLabel = fee > 0 ? `${fee} CC` : "Free";
  const hasCode =
    offer.rewardKind === "CODE_ONLY" || offer.rewardKind === "TOKEN_AND_CODE";
  const countdown = countdownLeft(offer.validUntil);

  async function handleClaim() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    tx.start({
      title: hasCode ? "Claiming invite code" : "Claiming reward",
      subtitle,
      amountText: hasCode ? "1 invite code" : "Reward",
      subText: subtitle,
      accentBg: "bg-violet-500/15",
      accentText: "text-violet-600",
      meta: [{ label: "Claim fee", value: feeLabel }],
    });
    tx.broadcast();

    try {
      // Prepare SATU ExerciseCommand Accept* → browser sign hash → execute.
      // (Jendela tanda tangan 10 menit — TTL relay.)
      const res = await fetch(`/api/quests/${questId}/claim-v30/prepare`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fcfs ? { fcfs: true } : {}),
      });
      const prep = (await res.json().catch(() => ({}))) as {
        hash?: string;
        description?: string;
        message?: string;
      };
      if (!res.ok || !prep.hash) {
        tx.dismiss();
        setError(prep.message || "Claim is not ready — try again in a moment.");
        return;
      }

      // Tanda tangan terjadi DI BROWSER (hash saja — kunci tidak pernah keluar).
      await signRelayPrepared(
        { hash: prep.hash, description: prep.description },
        {
          onWalletLocked: () =>
            promptPassphrase(
              `Claim ${hasCode ? "invite code" : "reward"} — fee ${fee} CC${subtitle ? ` — ${subtitle}` : ""}`,
            ),
        },
      );

      tx.succeed({ meta: [{ label: "Claim fee paid", value: feeLabel }] });
      await loadStatus();
      onClaimed();
    } catch (err) {
      tx.dismiss();
      setError(
        err instanceof Error && err.message ? err.message : "Claim failed — please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Selesai / sedang berjalan: tampilkan STATE, bukan tombol ────────────
  if (uiHint === "DONE" || (offer.claimStatus && offer.claimStatus !== "PreSettle")) {
    const st = offer.claimStatus;
    if (st === "Revealed" && status.revealedCode) {
      return (
        <div className="space-y-3">
          <CampaignStatusRow tone="emerald" icon={Trophy} strokeWidth={2.4} label="Reward Claimed">
            You won · your code is open below
          </CampaignStatusRow>
          <RewardReveal
            inviteCode={status.revealedCode}
            rewardType={rewardType}
            redeemUrl={redeemUrl}
            redeemInstructions={redeemInstructions}
          />
        </div>
      );
    }
    if (st === "RewardPending") {
      // UI-STATES.md: JANGAN "Success". Arahkan ke menu offer + deadline.
      return (
        <CampaignStatusRow tone="amber" icon={Clock} label="Check your offers">
          Your reward is waiting in your wallet&rsquo;s offer menu
          {countdown ? ` — you have ${countdown}.` : "."}{" "}
          <Link
            href="/wallet"
            className="font-semibold text-amber-600 underline underline-offset-2"
          >
            Open wallet offers
          </Link>
        </CampaignStatusRow>
      );
    }
    if (st === "RewardExpired") {
      return (
        <CampaignStatusRow tone="neutral" icon={AlertTriangle} label="Reward expired">
          The offer expired before the reward was received — the claim fee is
          not refunded. Contact support if you believe this is an error.
        </CampaignStatusRow>
      );
    }
    if (st === "Settled" || st === "Withdrawn") {
      return (
        <CampaignStatusRow tone="emerald" icon={Gift} label="Reward sent">
          Your reward was delivered directly to your wallet.
        </CampaignStatusRow>
      );
    }
  }

  if (uiHint === "NOT_DRAWN" || !offer.exists) {
    // Belum submit tugas → baris penuntun langkah berikutnya (jangan diam).
    if (!status.submitted && partyId) {
      return status.selection === "FCFS" ? (
        <CampaignStatusRow tone="sky" icon={Clock} label="You&rsquo;re in">
          Complete the task and press Submit — your FCFS slot and the Claim
          button appear the moment you submit.
        </CampaignStatusRow>
      ) : (
        <CampaignStatusRow tone="sky" icon={Clock} label="You&rsquo;re in">
          Complete the task and press Submit to enter the raffle — winners can
          claim after the event ends.
        </CampaignStatusRow>
      );
    }
    // FCFS: slot sudah diamankan saat submit — infokan, jangan diam saja.
    if (status.hasSlot) {
      return (
        <CampaignStatusRow tone="sky" icon={Clock} label="FCFS slot secured">
          Your slot is locked in — the Claim button appears once the event ends.
        </CampaignStatusRow>
      );
    }
    return null;
  }

  if (uiHint === "OFFER_EXPIRED") {
    return (
      <CampaignStatusRow tone="neutral" icon={Clock} label="Claim window closed">
        Your claim offer expired — contact the campaign operator.
      </CampaignStatusRow>
    );
  }

  // ── Pre-check blocks (UI-STATES.md — sebelum tanda tangan) ──────────────
  const needsUnlock = uiHint === "NEED_UNLOCK_OR_TOPUP";
  const noPreapproval = !prechecks.preapprovalActive;

  return (
    <div className="space-y-3">
      {passphraseModal}

      {needsUnlock ? (
        <CampaignStatusRow tone="amber" icon={Unlock} label="Unlock CC to claim">
          You need {fee} CC free balance for the fee —{" "}
          <Link
            href="/wallet"
            className="font-semibold text-amber-600 underline underline-offset-2"
          >
            unlock your CC in the wallet
          </Link>
          , then come back.
        </CampaignStatusRow>
      ) : (
        <>
          {noPreapproval ? (
            <CampaignStatusRow tone="sky" icon={AlertTriangle} label="Instant receive is off">
              Your reward will wait in the wallet offer menu and must be
              accepted manually —{" "}
              <Link
                href="/settings"
                className="font-semibold text-sky-600 underline underline-offset-2"
              >
                enable instant receive
              </Link>{" "}
              for direct delivery.
            </CampaignStatusRow>
          ) : null}

          <CampaignStatusRow
            tone="emerald"
            icon={Trophy}
            strokeWidth={2.4}
            label={status.selection === "FCFS" ? "FCFS Reward" : "Raffle Winner"}
          >
            You won · claim your{" "}
            {hasCode
              ? offer.rewardKind === "TOKEN_AND_CODE"
                ? "token + code"
                : "code"
              : "reward"}{" "}
            below
          </CampaignStatusRow>

          <CampaignClaimCta
            label={`Claim${fee > 0 ? ` (fee ${fee} CC)` : ""}`}
            isSubmitting={isSubmitting}
            error={error}
            onClaim={() => setClaimOpen(true)}
          />

          <ClaimDetailsModal
            open={claimOpen}
            onClose={() => setClaimOpen(false)}
            heroValue={hasCode ? "1" : "Reward"}
            heroUnit={hasCode ? "invite code" : undefined}
            rewardLabel="Reward"
            tokenHero={hasCode ? "CODE" : undefined}
            rows={[
              { label: "Claim fee", value: feeLabel, accent: fee <= 0 },
              {
                label: "Free CC balance",
                value: `${prechecks.freeBalanceCc} CC`,
                accent: prechecks.balanceOk,
              },
              ...(countdown
                ? [{ label: "Time left", value: countdown }]
                : []),
              { label: "Network", value: "Canton" },
            ]}
            eligibleHint="Sign once — fee and reward settle together on-chain"
            isConfirming={isSubmitting}
            onConfirm={() => {
              setClaimOpen(false);
              void handleClaim();
            }}
          />
        </>
      )}
    </div>
  );
}
