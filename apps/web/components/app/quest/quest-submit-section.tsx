"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import Link from "next/link";
import { PageTitle, SectionTitle, StatValue } from "@/components/ui/typography";
import type { QuestRewardStatus, RewardType } from "@/lib/quest/quest-types";
import {
  campaignUiKind,
  formatFcfsClaimFeeHint,
  formatFcfsSlotsRemaining,
  isFcfsSlotsFull,
  isUnluckyState,
  rewardCodeFromStatus,
  type CampaignMeta,
} from "@/lib/canton/campaign-reward";
import { CampaignFcfsRewardCard } from "@/components/app/campaign/campaign-fcfs-reward-card";
import { CampaignQuestStatusCard } from "@/components/app/campaign/campaign-quest-status-card";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { Check, CheckCircle2, ChevronDown, Clock, Copy, Shield, Sparkles, Ticket } from "lucide-react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { useState } from "react";

export type QuestLedgerProof = {
  enabled: boolean;
  participationContractId: string | null;
  completionContractId: string | null;
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
        buttonVariants({ size: "sm" }),
        copied && "brightness-95",
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
  const t = usePlatformT();

  return (
    <section className="py-6">
      <div className="text-center">

        {campaignEnded ? (
          <p className="mx-auto mt-6 max-w-md text-sm font-medium text-orange-300">
            {t("quests.campaignEndedClosed")}
          </p>
        ) : null}

        <button
          type="button"
          disabled={submitting || !partyId || campaignEnded}
          onClick={onSubmit}
          className={cn(buttonVariants({ size: "lg" }), "w-full max-w-sm py-7 text-lg font-bold")}
        >
          {submitting ? <LoadingSpinner size="lg" /> : null}
          {submitting ? "Submitting…" : "Submit"}
        </button>

        {!partyId && (
          <p className="mt-6 text-sm font-medium text-orange-300">
            <Link href="/wallet" className="font-semibold underline underline-offset-2">
              Create your wallet
            </Link>{" "}
            first — required for Quest and Earn.
          </p>
        )}
        {submitError && (
          <p className="mx-auto mt-6 max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 px-6 py-3 text-sm font-medium text-red-300">
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
  const completionId = ledger?.completionContractId ?? null;
  const taskCount = ledger?.taskSubmissionCount ?? 0;
  const [proofOpen, setProofOpen] = useState(false);

  // CC_AND_INVITE is a legacy type — migrated to CC_AND_CODE_RAFFLE in DB.
  // Keep the string comparison as `string` to handle any remaining legacy rows.
  const isCcAndInvite =
    (rt as string) === "CC_AND_INVITE" &&
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

  // CC + Code Raffle: claimable state is handled by CampaignCcAndCodeRaffleClaimSection
  if (uiKind === "cc_and_code_raffle" && state === "fcfs_claimable") {
    return null;
  }

  if (uiKind === "cc_and_code_raffle" && state === "waitlist") {
    return (
      <CampaignQuestStatusCard
        tone="sky"
        label="CC + Code Raffle"
        title="Entry recorded"
        description="Winners will be announced after the event ends. You will receive both CC and an invite code."
        icon={CheckCircle2}
      />
    );
  }

  if (uiKind === "cc_and_code_raffle" && state === "cc_reward") {
    return (
      <section className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/12 via-[var(--card)] to-[var(--card)] p-6 ring-1 ring-emerald-500/20">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-400" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-400/80">
              Raffle Reward
            </p>
            <p className="mt-0.5 text-base font-bold text-white">Reward claimed</p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {/* CC reward row */}
          <div className="flex items-center gap-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary)]/10 px-4 py-3">
            <CcRewardLogo size={20} />
            <span className="text-sm font-bold text-canton">+{rewardCc ?? 0} CC sent to your wallet</span>
          </div>
          {/* Invite code row — konsisten dengan claim card (RewardReveal). */}
          {inviteCode ? (
            <RewardReveal inviteCode={inviteCode} />
          ) : (
            <p className="text-sm text-slate-400">
              {rewardStatus?.message ?? `${rewardCc ?? 0} CC and your invite code have been sent.`}
            </p>
          )}
        </div>
      </section>
    );
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
      <section className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/12 via-[var(--card)] to-[var(--card)] p-10 text-center ring-1 ring-emerald-500/20">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
        <PageTitle className="mt-6 text-2xl font-bold text-slate-100">Campaign complete</PageTitle>
        <p className="mx-auto mt-3 max-w-md text-sm font-medium text-slate-400">
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
    <section className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/12 via-[var(--card)] to-[var(--card)] ring-1 ring-emerald-500/20">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,rgb(var(--canton-rgb)/0.25)_0%,transparent_70%)]"
        aria-hidden
      />

      <div className="relative px-8 pb-6 pt-10 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--primary)] shadow-[0_0_32px_rgb(var(--canton-rgb)/0.4)] ring-4 ring-[var(--primary)]/20">
          <CheckCircle2
            className="h-10 w-10 text-[var(--primary-foreground)]"
            strokeWidth={2.5}
            aria-hidden
          />
        </div>
        <PageTitle className="mt-6 text-2xl font-bold text-slate-100">Congratulations!</PageTitle>
        <p className="mt-2 text-sm font-medium text-slate-400">
          {showCcReward || inviteCode
            ? "Your rewards are ready below"
            : rewardStatus?.message ?? "Quest recorded successfully"}
        </p>
        {uiKind === "waitlist_code" && state === "winner" && inviteCode ? (
          <p className="mt-2 text-sm font-medium text-violet-300">Winner — copy your reward code below.</p>
        ) : null}
      </div>

      <div className="relative space-y-6 px-6 pb-8">
        {inviteCode && (
          <div className="rounded-3xl border border-violet-500/35 bg-gradient-to-br from-violet-500/15 to-[var(--card)] p-6">
            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-violet-300/80">
              <Ticket className="h-5 w-5" />
              Your code
            </div>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <StatValue className="text-4xl font-bold tracking-wide text-slate-100">
                {inviteCode}
              </StatValue>
              <CopyButton value={inviteCode} />
            </div>
            {isCcAndInvite && (
              <p className="mt-4 text-sm font-medium text-slate-400">
                {rewardStatus?.message}
              </p>
            )}
          </div>
        )}

        {showCcReward && uiKind !== "cc_fcfs" && (
          <div className="flex items-center gap-5 rounded-3xl border border-[var(--primary)]/30 bg-gradient-to-r from-[var(--primary)]/15 to-[rgb(var(--canton-cyan-rgb)/0.08)] p-6">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)]/25">
              <CcRewardLogo size={28} />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                CC reward
              </p>
              <StatValue className="text-2xl font-bold text-canton">+{rewardCc} CC</StatValue>
              <p className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-400">
                <Sparkles className="h-4 w-4 text-canton" />
                Sent to your wallet
              </p>
            </div>
          </div>
        )}

        {!isCcAndInvite &&
          rewardStatus?.message &&
          !inviteCode &&
          uiKind !== "cc_fcfs" && (
          <p className="rounded-2xl border border-white/5 bg-[var(--muted)]/40 px-6 py-4 text-center text-sm font-medium text-slate-100">
            {rewardStatus.message}
          </p>
        )}

        {(participationId || completionId) && (
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-[var(--card)]/80">
            <button
              type="button"
              onClick={() => setProofOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-[var(--muted)]/30"
            >
              <span className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                <Shield className="h-4 w-4" />
                On-chain proof
                {taskCount > 0 ? (
                  <span className="font-normal normal-case tracking-normal text-slate-400">
                    · {taskCount} task{taskCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-3">
                <code className="font-mono text-sm font-medium text-slate-400">
                  {shortLedgerId(participationId ?? completionId ?? "")}
                </code>
                <ChevronDown
                  className={cn(
                    "h-5 w-5 text-slate-400 transition-transform",
                    proofOpen && "rotate-180",
                  )}
                />
              </span>
            </button>
            {proofOpen && (
              <div className="space-y-3 border-t border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3">
                {participationId ? (
                  <div>
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
                ) : null}
                {completionId ? (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                      QuestCompletion
                    </p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <code className="break-all font-mono text-[11px] leading-relaxed">
                        {completionId}
                      </code>
                      <CopyButton value={completionId} className="self-start" />
                    </div>
                  </div>
                ) : null}
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
