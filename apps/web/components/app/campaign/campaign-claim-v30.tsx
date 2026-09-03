"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Clock, Gift, Unlock } from "lucide-react";
import Link from "next/link";
import { CampaignClaimCta } from "@/components/app/campaign/campaign-claim-cta";
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
        <StateCard tone="amber" icon={Clock} title="Check your offers">
          <p>
            Your reward is waiting in your wallet&apos;s offer menu.
            {countdown ? ` You have ${countdown}.` : ""}
          </p>
          <Link
            href="/wallet"
            className="inline-flex items-center gap-1 text-sm font-medium text-amber-300 hover:text-amber-200"
          >
            Open wallet offers <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </StateCard>
      );
    }
    if (st === "RewardExpired") {
      return (
        <StateCard tone="rose" icon={AlertTriangle} title="Reward expired">
          <p>
            The reward offer expired before it was received. The claim fee is
            not refunded by the contract — contact support if you believe this
            is an error.
          </p>
        </StateCard>
      );
    }
    if (st === "Settled" || st === "Withdrawn") {
      return (
        <StateCard tone="emerald" icon={Gift} title="Reward sent to your wallet">
          <p>Your reward was delivered directly to your wallet.</p>
        </StateCard>
      );
    }
  }

  if (uiHint === "NOT_DRAWN" || !offer.exists) {
    // Belum submit tugas → kartu penuntun langkah berikutnya (jangan diam).
    if (!status.submitted && partyId) {
      return status.selection === "FCFS" ? (
        <StateCard tone="sky" icon={Clock} title="You&rsquo;re in — secure your slot">
          <p>
            Complete the task and press <strong>Submit</strong>. Your FCFS slot
            and the Claim button appear the moment you submit.
          </p>
        </StateCard>
      ) : (
        <StateCard tone="sky" icon={Clock} title="You&rsquo;re in — join the draw">
          <p>
            Complete the task and press <strong>Submit</strong> to enter the
            raffle. Winners can claim after the event ends.
          </p>
        </StateCard>
      );
    }
    // FCFS: slot sudah diamankan saat submit — infokan, jangan diam saja.
    if (status.hasSlot) {
      return (
        <StateCard tone="sky" icon={Clock} title="FCFS slot secured">
          <p>
            Your slot is locked in. The claim button appears here once the event
            ends.
          </p>
        </StateCard>
      );
    }
    return null;
  }

  if (uiHint === "OFFER_EXPIRED") {
    return (
      <StateCard tone="rose" icon={Clock} title="Claim window closed">
        <p>
          Your claim offer expired.
          Contact the campaign operator.
        </p>
      </StateCard>
    );
  }

  // ── Pre-check blocks (UI-STATES.md — sebelum tanda tangan) ──────────────
  const needsUnlock = uiHint === "NEED_UNLOCK_OR_TOPUP";
  const noPreapproval = !prechecks.preapprovalActive;

  return (
    <div className="space-y-3">
      {passphraseModal}

      {needsUnlock ? (
        <StateCard tone="amber" icon={Unlock} title="Unlock CC to claim">
          <p>
            You need {fee} CC free balance to pay the claim fee. Your locked CC
            unlocks automatically when the campaign ends — unlock it in your
            wallet first, then come back.
          </p>
          <Link
            href="/wallet"
            className="inline-flex items-center gap-1 text-sm font-medium text-amber-300 hover:text-amber-200"
          >
            Go to wallet <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </StateCard>
      ) : (
        <>
          {noPreapproval ? (
            <StateCard tone="sky" icon={AlertTriangle} title="Enable instant receive">
              <p>
                Instant receive (preapproval) is off — your reward will sit in
                the wallet offer menu and must be accepted manually. Enable it
                in Settings for direct delivery.
              </p>
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 text-sm font-medium text-sky-300 hover:text-sky-200"
              >
                Open settings <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </StateCard>
          ) : null}

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

/** Kartu status sederhana (mirror CampaignStatusRow tones). */
function StateCard({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "emerald" | "amber" | "rose" | "sky";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <div className="mt-1 space-y-1 text-sm text-current/80">{children}</div>
    </div>
  );
}
