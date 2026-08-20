"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import Link from "next/link";
import type {
  QuestRewardStatus,
  RewardType,
  RewardTokenSymbol,
} from "@/lib/quest/quest-types";
import { normalizeRewardToken } from "@/lib/quest/quest-types";
import {
  campaignUiKind,
  formatRewardAmount,
  isFcfsSlotsFull,
  isUnluckyState,
  rewardCodeFromStatus,
  type CampaignMeta,
} from "@/lib/canton/campaign-reward";
import { CampaignStatusRow } from "@/components/app/campaign/campaign-status-row";
import { RewardReveal } from "@/components/app/campaign/reward-reveal";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { errorBannerClass, warnBannerClass } from "@/lib/ui/ui-tokens";
import { cn } from "@/lib/utils/utils";
import { Check, ChevronDown, Clock, Copy, Hourglass, Shield, Sparkles, Ticket, X } from "lucide-react";
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
      <Card className="overflow-hidden px-6 py-8 text-center">
        {campaignEnded ? (
          <p className={cn("relative mx-auto mt-2 max-w-md", warnBannerClass)}>
            {t("quests.campaignEndedClosed")}
          </p>
        ) : null}

        <button
          type="button"
          disabled={submitting || !partyId || campaignEnded}
          onClick={onSubmit}
          className={cn(
            buttonVariants({ size: "default" }),
            "relative min-w-[8rem] px-5",
          )}
        >
          {submitting ? <LoadingSpinner size="sm" /> : null}
          {submitting ? "Submitting…" : "Submit"}
        </button>

        {!partyId && (
          <p className={cn("relative mt-6", warnBannerClass)}>
            <Link href="/wallet" className="font-semibold underline underline-offset-2">
              Create your wallet
            </Link>{" "}
            first — required for Quest and Earn.
          </p>
        )}
        {submitError && (
          <p className={cn("relative mx-auto mt-6 max-w-md", errorBannerClass)}>
            {submitError}
          </p>
        )}
      </Card>
    </section>
  );
}

/** Label prefix baris status per uiKind (mockup rev. user). */
function notSelectedLabel(uiKind: string): string {
  if (uiKind === "cc_manual_draw") return "Raffle Result";
  if (uiKind === "waitlist_code") return "Code Raffle";
  if (uiKind === "cc_and_code_raffle") return "CC + Code Raffle";
  return "Draw Result";
}

/** Ikon jam — Clock utk pending draw, Hourglass utk entry tercatat (mockup). */
const ICON_SW = 2.4;

export function QuestSubmittedProof({
  rewardCc,
  rewardStatus,
  ledger,
  rewardType,
  campaignMeta,
  redeemUrl,
  redeemInstructions,
  rewardToken,
}: {
  rewardCc: number | null;
  rewardStatus: QuestRewardStatus | null;
  ledger: QuestLedgerProof | null;
  rewardType?: RewardType | string | null;
  campaignMeta?: CampaignMeta | null;
  /** Link register/landing proyek (shown in "How to use" reveal). */
  redeemUrl?: string | null;
  /** Instruksi custom redeem; kosong = pakai template 3-step default. */
  redeemInstructions?: string | null;
  /** Token reward: "CC" (default) atau "USDCx". Mendorong pesan delivery jadi token-aware. */
  rewardToken?: RewardTokenSymbol | string | null;
}) {
  const rt = (rewardType ?? "CC_ONLY") as RewardType;
  const token = normalizeRewardToken(rewardToken);
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

  // ── FCFS token: claimed / full ───────────────────────────────────
  if (uiKind === "cc_fcfs" && state === "cc_reward") {
    const slotsFull = isFcfsSlotsFull(
      campaignMeta?.remainingSlots,
      campaignMeta?.maxWinners,
    );
    return (
      <div className="space-y-3">
        {slotsFull ? (
          <CampaignStatusRow tone="neutral" icon={Check} label="FCFS Reward">
            Full claimed, all slots taken
          </CampaignStatusRow>
        ) : (
          <CampaignStatusRow tone="emerald" icon={Check} label="FCFS Reward">
            Claimed · sent to your wallet
          </CampaignStatusRow>
        )}
      </div>
    );
  }

  // ── Tidak terpilih / kehabisan slot ──────────────────────────────
  if (isUnluckyState(state)) {
    if (state === "fcfs_missed" && uiKind === "cc_fcfs") {
      return (
        <CampaignStatusRow tone="neutral" icon={X} label="FCFS Reward">
          Slots ran out before you claimed
        </CampaignStatusRow>
      );
    }
    return (
      <CampaignStatusRow tone="neutral" icon={X} label={notSelectedLabel(uiKind)}>
        Not selected this time
      </CampaignStatusRow>
    );
  }

  // ── Invite code: pool kode habis ─────────────────────────────────
  if (
    uiKind === "waitlist_code" &&
    state === "fcfs_claimable" &&
    (campaignMeta?.codesRemaining ?? 0) <= 0
  ) {
    return (
      <CampaignStatusRow tone="neutral" icon={X} label="Invite Code">
        All codes have been claimed
      </CampaignStatusRow>
    );
  }

  // ── Waitlist email ────────────────────────────────────────────────
  if (uiKind === "waitlist_email" && state === "winner") {
    return (
      <CampaignStatusRow tone="emerald" icon={Check} label="Waitlist">
        Selected · check your email
      </CampaignStatusRow>
    );
  }

  if (uiKind === "waitlist_email" && state === "waitlist") {
    return (
      <CampaignStatusRow tone="sky" icon={Sparkles} strokeWidth={ICON_SW} label="Waitlist">
        Recorded · we&apos;ll email you at launch
      </CampaignStatusRow>
    );
  }

  // ── Claimable → ditangani claim section (baris WIN + tombol Claim) ──
  if (uiKind === "cc_manual_draw" && state === "fcfs_claimable") {
    return null;
  }

  // CC + Code Raffle: claimable state is handled by CampaignCcAndCodeRaffleClaimSection
  if (uiKind === "cc_and_code_raffle" && state === "fcfs_claimable") {
    return null;
  }

  // ── Raffle: entry tercatat / menunggu draw ───────────────────────
  if (uiKind === "cc_and_code_raffle" && state === "waitlist") {
    return (
      <CampaignStatusRow tone="sky" icon={Hourglass} strokeWidth={ICON_SW} label="CC + Code Raffle">
        Entry recorded · winners drawn at close
      </CampaignStatusRow>
    );
  }

  if (uiKind === "cc_manual_draw" && state === "waitlist") {
    return (
      <CampaignStatusRow tone="sky" icon={Hourglass} strokeWidth={ICON_SW} label="Raffle Entry">
        Recorded · winners drawn when the campaign ends
      </CampaignStatusRow>
    );
  }

  if (uiKind === "cc_manual_draw" && state === "cc_reward") {
    return (
      <CampaignStatusRow tone="emerald" icon={Check} label="Raffle Reward">
        Claimed · sent to your wallet
      </CampaignStatusRow>
    );
  }

  if (uiKind === "cc_and_code_raffle" && state === "cc_reward") {
    return (
      <div className="space-y-3">
        <CampaignStatusRow tone="emerald" icon={Check} label="CC + Code Raffle">
          Claimed · token sent + code below
        </CampaignStatusRow>
        {inviteCode ? (
          <RewardReveal
            inviteCode={inviteCode}
            rewardType={rewardType}
            redeemUrl={redeemUrl}
            redeemInstructions={redeemInstructions}
          />
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            {rewardStatus?.message ??
              `${formatRewardAmount(rewardCc ?? 0, token)} has been sent to your wallet.`}
          </p>
        )}
      </div>
    );
  }

  if (uiKind === "cc_manual" && state === "cc_reward") {
    return (
      <CampaignStatusRow tone="emerald" icon={Check} label="Reward">
        Will be sent manually by the team · watch your wallet
      </CampaignStatusRow>
    );
  }

  if (state === "pending_draw") {
    return (
      <CampaignStatusRow tone="amber" icon={Clock} strokeWidth={ICON_SW} label="Raffle Draw">
        {uiKind === "cc_manual_draw"
          ? "Campaign ended · awaiting winner draw"
          : "Awaiting winner draw"}
      </CampaignStatusRow>
    );
  }

  return (
    <div className="space-y-6">
        {uiKind === "waitlist_code" && state === "winner" && inviteCode ? (
          <CampaignStatusRow tone="emerald" icon={Ticket} strokeWidth={ICON_SW} label="Invite Code">
            Claimed · save your code below
          </CampaignStatusRow>
        ) : null}

        {(inviteCode || showCcReward) && uiKind !== "cc_fcfs" ? (
          <RewardReveal
            inviteCode={inviteCode}
            rewardCc={showCcReward ? (rewardCc ?? 0) : 0}
            rewardType={rewardType}
            redeemUrl={redeemUrl}
            redeemInstructions={redeemInstructions}
          />
        ) : null}

        {/* Pesan custom pemenang (CC_AND_INVITE legacy / waitlist code winner). */}
        {isCcAndInvite && rewardStatus?.message ? (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/40 px-6 py-4 text-center text-sm font-medium text-[var(--foreground)]">
            {rewardStatus.message}
          </p>
        ) : null}

        {!isCcAndInvite &&
          rewardStatus?.message &&
          !inviteCode &&
          uiKind !== "cc_fcfs" && (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/40 px-6 py-4 text-center text-sm font-medium text-[var(--foreground)]">
            {rewardStatus.message}
          </p>
        )}

        {(participationId || completionId) && (
          <Card bare className="overflow-hidden rounded-2xl">
            <button
              type="button"
              onClick={() => setProofOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-[var(--muted)]/30"
            >
              <span className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                <Shield className="h-4 w-4" />
                On-chain proof
                {taskCount > 0 ? (
                  <span className="font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
                    · {taskCount} task{taskCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-3">
                <code className="font-mono text-sm font-medium text-[var(--muted-foreground)]">
                  {shortLedgerId(participationId ?? completionId ?? "")}
                </code>
                <ChevronDown
                  className={cn(
                    "h-5 w-5 text-[var(--muted-foreground)] transition-transform",
                    proofOpen && "rotate-180",
                  )}
                />
              </span>
            </button>
            {proofOpen && (
              <div className="space-y-3 border-t border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3">
                {participationId ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      QuestParticipation
                    </p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <code className="break-all font-mono text-xs leading-relaxed">
                        {participationId}
                      </code>
                      <CopyButton value={participationId} className="self-start" />
                    </div>
                  </div>
                ) : null}
                {completionId ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                      QuestCompletion
                    </p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <code className="break-all font-mono text-xs leading-relaxed">
                        {completionId}
                      </code>
                      <CopyButton value={completionId} className="self-start" />
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        )}

      {ledger && ledger.errors.length > 0 && (
        <div className={cn("text-xs", warnBannerClass)}>
          {ledger.errors.join(" · ")}
        </div>
      )}
    </div>
  );
}
