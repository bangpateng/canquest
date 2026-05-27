"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import Link from "next/link";
import { PageTitle, SectionTitle, StatValue } from "@/components/ui/typography";
import type { QuestRewardStatus, RewardType } from "@/lib/quest-types";
import {
  campaignUiKind,
  formatFcfsClaimFeeHint,
  formatFcfsSlotsRemaining,
  isFcfsSlotsFull,
  isUnluckyState,
  rewardCodeFromStatus,
  type CampaignMeta,
} from "@/lib/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign-fcfs-reward-card";
import { CampaignQuestStatusCard } from "@/components/app/campaign-quest-status-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, CheckCircle2, ChevronDown, Clock, Coins, Copy, Rocket, Shield, Sparkles, Ticket } from "lucide-react";
import { useState } from "react";

export type QuestLedgerProof = {
  enabled: boolean;
  participationContractId: string | null;
  rewardContractId: string | null;
  taskSubmissionCount: number;
  cip56Queued: boolean;
  errors: string[];
};

function shortLedgerId(id: string): string {
  if (id.length <= 24) return id;
  return `${id.slice(0, 10)}…${id.slice(-8)}`;
}

function CopyButton({
  value,
  className,
  label = "Copy",
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all",
        copied
          ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
          : "bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-110",
        className,
      )}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </>
      )}
    </button>
  );
}

export function QuestSubmitSection({
  partyId,
  submitting,
  submitError,
  onSubmit,
  cantonLedgerConfigured = false,
  campaignEnded = false,
}: {
  partyId: string | null;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
  /** When false, final submit is DB-only (no DAML contracts). */
  cantonLedgerConfigured?: boolean;
  campaignEnded?: boolean;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--primary)]/40 bg-gradient-to-br from-[var(--primary)]/15 via-[var(--card)] to-[var(--card)] p-6 md:p-8">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--canton-rgb)/0.2)_0%,transparent_60%)]"
        aria-hidden
      />
      <div className="relative text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-canton">
          <Sparkles className="h-3.5 w-3.5" />
          All missions verified
        </span>
        <SectionTitle as="h4" className="mt-4">
          {cantonLedgerConfigured ? "Submit to Canton" : "Submit quest"}
        </SectionTitle>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
          {cantonLedgerConfigured
            ? "Final step records your participation on-chain and triggers rewards."
            : "Final step saves your completion and applies quest rewards."}
        </p>

        {campaignEnded ? (
          <p className="mx-auto mt-4 max-w-md text-sm text-orange-300">
            This campaign has ended. Final submit is closed.
          </p>
        ) : null}

        <button
          type="button"
          disabled={submitting || !partyId || campaignEnded}
          onClick={onSubmit}
          className={cn(
            buttonVariants({ size: "lg" }),
            "mt-8 w-full max-w-sm gap-2 rounded-full py-6 text-base font-bold",
            "shadow-[0_0_40px_rgb(var(--canton-rgb)/0.35)] hover:shadow-[0_0_48px_rgb(var(--canton-rgb)/0.45)]",
          )}
        >
          {submitting ? (
            <LoadingSpinner size="lg" />
          ) : (
            <Rocket className="h-5 w-5" />
          )}
          {submitting ? "Submitting…" : "Submit quest"}
          {!submitting && <ArrowRight className="h-4 w-4" />}
        </button>

        {!partyId && (
          <p className="mt-4 text-xs text-orange-300">
            <Link href="/wallet" className="font-semibold underline underline-offset-2">
              Create your wallet
            </Link>{" "}
            first — required for Quest, Earn, and Spin Reward.
          </p>
        )}
        {submitError && (
          <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-300">
            {submitError}
          </p>
        )}
      </div>
    </section>
  );
}

export function QuestSubmittedProof({
  rewardCc,
  rewardStatus,
  ledger,
  rewardType,
  campaignMeta,
}: {
  rewardCc: number | null;
  rewardStatus: QuestRewardStatus | null;
  ledger: QuestLedgerProof | null;
  rewardType?: RewardType | string | null;
  campaignMeta?: CampaignMeta | null;
}) {
  const rt = (rewardType ?? "CC_ONLY") as RewardType;
  const state = rewardStatus?.state;
  const inviteCode = rewardCodeFromStatus(rewardStatus);
  const uiKind = campaignUiKind(rt, campaignMeta?.requiresFcfsClaim ?? false);
  const participationId = ledger?.participationContractId ?? null;
  const [proofOpen, setProofOpen] = useState(false);

  const isCcAndInvite =
    rt === "CC_AND_INVITE" &&
    Boolean(inviteCode) &&
    (rewardCc ?? 0) > 0;
  const showCcReward =
    (isCcAndInvite && (rewardCc ?? 0) > 0) ||
    (uiKind === "cc_fcfs" && state === "cc_reward" && (rewardCc ?? 0) > 0);
  const fcfsSlotsLabel =
    uiKind === "cc_fcfs" && campaignMeta
      ? formatFcfsSlotsRemaining(
          campaignMeta.remainingSlots ?? 0,
          campaignMeta.maxWinners,
        )
      : null;
  const fcfsFeeHint =
    uiKind === "cc_fcfs" && campaignMeta
      ? formatFcfsClaimFeeHint(campaignMeta.fcfsClaimFeeCc, rewardCc ?? 0)
      : null;

  if (uiKind === "cc_fcfs" && state === "cc_reward" && fcfsSlotsLabel) {
    const slotsFull = campaignMeta
      ? isFcfsSlotsFull(campaignMeta.remainingSlots, campaignMeta.maxWinners)
      : fcfsSlotsLabel.toLowerCase().includes("ended");
    return (
      <CampaignFcfsRewardCard
        mode="status"
        slotsLabel={fcfsSlotsLabel}
        description={
          slotsFull
            ? "All reward slots are taken. Thanks for completing the campaign tasks."
            : fcfsFeeHint
        }
      />
    );
  }

  if (isUnluckyState(state)) {
    return (
      <CampaignQuestStatusCard
        tone="neutral"
        label="Draw result"
        title="Not selected this time"
        description={
          "You were not selected in the raffle draw. Thanks for participating — better luck on the next campaign."
        }
        icon={CheckCircle2}
      />
    );
  }

  if (uiKind === "waitlist_email" && state === "winner") {
    return (
      <section className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/12 via-[var(--card)] to-[var(--card)] p-8 text-center ring-1 ring-emerald-500/20">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
        <PageTitle className="mt-4">Congratulations — you&apos;re selected!</PageTitle>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
          {rewardStatus?.message ??
            "You were selected in the draw. Check your email or the message below for next steps."}
        </p>
      </section>
    );
  }

  if (uiKind === "waitlist_email" && state === "waitlist") {
    return (
      <section className="relative overflow-hidden rounded-2xl border border-sky-500/30 bg-gradient-to-b from-sky-500/10 via-[var(--card)] to-[var(--card)] p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-sky-400" />
        <PageTitle className="mt-4">You&apos;re on the waitlist</PageTitle>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
          {rewardStatus?.message ??
            "Your email is registered. We will contact you if you are selected."}
        </p>
      </section>
    );
  }

  if (uiKind === "cc_manual_draw" && state === "fcfs_claimable") {
    return null;
  }

  if (uiKind === "cc_manual_draw" && state === "waitlist") {
    return (
      <CampaignQuestStatusCard
        tone="sky"
        label="Quest submitted"
        title="Entry recorded"
        description="Winners will be announced after the event ends."
        icon={CheckCircle2}
      />
    );
  }

  if (uiKind === "cc_manual_draw" && state === "cc_reward") {
    return (
      <CampaignQuestStatusCard
        tone="emerald"
        label="Raffle reward"
        title="Reward claimed"
        description={`${rewardCc ?? 0} CC has been sent to your wallet.`}
        icon={CheckCircle2}
      />
    );
  }

  if (uiKind === "cc_manual" && state === "cc_reward") {
    return (
      <section className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/12 via-[var(--card)] to-[var(--card)] p-8 text-center ring-1 ring-emerald-500/20">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
        <PageTitle className="mt-4">Campaign complete</PageTitle>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
          {rewardStatus?.message ??
            `${rewardCc ?? 0} CC will be sent manually by the team via bulk sender. Watch your wallet and email.`}
        </p>
      </section>
    );
  }

  if (state === "pending_draw") {
    const pendingDescription =
      uiKind === "cc_manual_draw"
        ? "The event has ended. Winners will be announced after the admin runs the draw."
        : "The admin will run the random draw. Your reward will appear here if you are selected.";
    return (
      <CampaignQuestStatusCard
        tone="amber"
        label="Draw pending"
        title="Submitted — awaiting draw"
        description={pendingDescription}
        icon={Clock}
      />
    );
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/12 via-[var(--card)] to-[var(--card)] ring-1 ring-emerald-500/20">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,rgb(var(--canton-rgb)/0.25)_0%,transparent_70%)]"
        aria-hidden
      />

      <div className="relative px-6 pb-4 pt-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--primary)] shadow-[0_0_32px_rgb(var(--canton-rgb)/0.4)] ring-4 ring-[var(--primary)]/20">
          <CheckCircle2
            className="h-8 w-8 text-[var(--primary-foreground)]"
            strokeWidth={2.5}
            aria-hidden
          />
        </div>
        <PageTitle className="mt-5">Congratulations!</PageTitle>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {showCcReward || inviteCode
            ? "Your rewards are ready below"
            : rewardStatus?.message ?? "Quest recorded successfully"}
        </p>
        {uiKind === "waitlist_code" && state === "winner" && inviteCode ? (
          <p className="mt-1 text-xs text-violet-300">Winner — copy your reward code below.</p>
        ) : null}
      </div>

      <div className="relative space-y-4 px-4 pb-6">
        {inviteCode && (
          <div className="rounded-2xl border border-violet-500/35 bg-gradient-to-br from-violet-500/15 to-[var(--card)] p-5">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-violet-300/80">
              <Ticket className="h-4 w-4" />
              Your code
            </div>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <StatValue className="text-3xl tracking-wide text-[var(--foreground)]">
                {inviteCode}
              </StatValue>
              <CopyButton value={inviteCode} />
            </div>
            {isCcAndInvite && (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                {rewardStatus?.message}
              </p>
            )}
          </div>
        )}

        {showCcReward && uiKind !== "cc_fcfs" && (
          <div className="flex items-center gap-4 rounded-2xl border border-[var(--primary)]/30 bg-gradient-to-r from-[var(--primary)]/15 to-[rgb(var(--canton-cyan-rgb)/0.08)] p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)]/25">
              <Coins className="h-6 w-6 text-canton" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                CC reward
              </p>
              <StatValue className="text-canton">+{rewardCc} CC</StatValue>
              <p className="mt-0.5 flex items-center gap-1 text-sm text-[var(--muted-foreground)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--primary-strong)]" />
                Sent to your wallet
              </p>
            </div>
          </div>
        )}

        {!isCcAndInvite &&
          rewardStatus?.message &&
          !inviteCode &&
          uiKind !== "cc_fcfs" && (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 text-center text-sm font-medium">
            {rewardStatus.message}
          </p>
        )}

        {participationId && (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]/80">
            <button
              type="button"
              onClick={() => setProofOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--muted)]/30"
            >
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Shield className="h-3.5 w-3.5" />
                On-chain proof
              </span>
              <span className="flex items-center gap-2">
                <code className="font-mono text-[11px] text-[var(--muted-foreground)]">
                  {shortLedgerId(participationId)}
                </code>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-[var(--muted-foreground)] transition-transform",
                    proofOpen && "rotate-180",
                  )}
                />
              </span>
            </button>
            {proofOpen && (
              <div className="border-t border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                  QuestParticipation
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <code className="break-all font-mono text-[11px] leading-relaxed">
                    {participationId}
                  </code>
                  <CopyButton value={participationId} className="self-start" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {ledger && ledger.errors.length > 0 && (
        <div className="mx-4 mb-4 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-200">
          {ledger.errors.join(" · ")}
        </div>
      )}
    </section>
  );
}
