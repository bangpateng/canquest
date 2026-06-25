"use client";

import type {
  Quest,
  QuestTask,
  QuestTaskType,
  QuestSubmission,
  QuestRewardStatus,
} from "@/lib/quest/quest-types";
import {
  TASK_ACTION_BUTTON_LABEL,
  TASK_COUNTDOWN_SEC,
  formatTaskCountdownSeconds,
  resolveQuestTaskDisplayTitle,
  formatEarnHubCooldown,
  getEarnHubRepeatCooldownMs,
  getEarnHubTaskRowDisplay,
  isEarnHubQuizExpired,
  isEarnHubQuizType,
  isEarnHubRepeatableTask,
  isEarnHubSocialType,
  parseQuizChoices,
} from "@/lib/quest/quest-types";
import { CampaignFcfsClaimSection } from "@/components/app/campaign/campaign-fcfs-claim";
import { CampaignDrawCcClaimSection } from "@/components/app/campaign/campaign-draw-cc-claim";
import { CampaignCcAndCodeRaffleClaimSection } from "@/components/app/campaign/campaign-cc-and-code-raffle-claim";
import { TaskPointsLabel } from "@/components/app/quest/task-points-label";
import { CampaignInviteClaimSection } from "@/components/app/campaign/campaign-invite-claim";
import {
  QuestSubmitSection,
  QuestSubmittedProof,
  type QuestLedgerProof,
} from "@/components/app/quest/quest-submit-section";
import {
  type CampaignMeta,
  isCampaignEnded,
  isFcfsSlotsFull,
} from "@/lib/canton/campaign-reward";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { WalletCreatePromptModal } from "@/components/app/wallet/wallet-create-prompt";
import { TaskBrandIcon } from "@/components/app/quest/task-brand-icon";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { hasRealWallet } from "@/lib/auth/wallet-access";
import {
  CalendarCheck,
  Check,
  CheckCircle2,
  Circle,
  Fingerprint,
  HelpCircle,
  Lock,
  Mail,
  Repeat2,
  Send,
  UserPlus,
  Users,
} from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function normalizeType(type: string): string {
  if (type === "telegram_join") return "telegram_channel";
  return type;
}

function isTwitterTaskType(type: string): boolean {
  const t = normalizeType(type);
  return t === "twitter_follow" || t === "twitter_retweet";
}

function parseApiErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  }
  return "Submission failed";
}

function quizAnswerKey(answer: string, taskType: string): string {
  return taskType === "quiz_choice" ? answer.trim().toUpperCase() : answer.trim().toLowerCase();
}

function taskActionButtonLabel(type: string): string {
  const key = normalizeType(type);
  return TASK_ACTION_BUTTON_LABEL[key] ?? TASK_ACTION_BUTTON_LABEL[type] ?? "Open";
}

/**
 * Baris meta di bawah judul mission: petunjuk aksi ringkas + target (mis. handle /
 * link channel). Menggantikan label platform redundan lama (info platform sudah
 * ada di ikon + judul). Kembalikan null bila tidak ada yang berguna ditampilkan.
 */
function taskActionHint(task: QuestTask, type: string): string | null {
  const t = normalizeType(type);
  const rawTarget = (task.target ?? "").trim();
  const handle = rawTarget.replace(/^@/, "");

  const hints: Record<string, string> = {
    twitter_follow: handle
      ? `Follow @${handle}, then tap to verify`
      : "Tap to follow & verify",
    twitter_retweet: handle
      ? `Retweet @${handle}, then tap to verify`
      : "Tap to retweet & verify",
    telegram_channel: "Join the channel, then tap to verify",
    telegram_group: "Join the group, then tap to verify",
    telegram_join: "Join the channel, then tap to verify",
    discord_join: "Join the server, then tap to verify",
    submit_email: "Enter your email to verify",
    submit_party_id: "Submit your Canton party ID to verify",
    submit_canton_address: "Submit your Canton party ID to verify",
    daily_check_in: "Check in daily to earn points",
    quiz_yes_no: "Pick the correct answer",
    quiz_choice: "Pick the correct answer",
  };
  return hints[t] ?? null;
}

function openTaskTarget(task: QuestTask, taskType: string) {
  const target = task.target?.trim();
  if (target?.startsWith("http")) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  if (taskType === "twitter_follow" || taskType === "twitter_retweet") {
    const handle = (target ?? "").replace(/^@/, "");
    if (handle) {
      window.open(`https://x.com/${handle}`, "_blank", "noopener,noreferrer");
    }
  }
}

export function QuestTaskPanel({
  quest,
  viewerPartyId = null,
  viewerTwitterUsername = null,
  onPointsEarned,
}: {
  quest: Quest;
  /** Wallet from parent (earn hub); panel still fetches /api/me if omitted. */
  viewerPartyId?: string | null;
  /** Linked X handle from parent; panel still refreshes from /api/me. */
  viewerTwitterUsername?: string | null;
  /** Called when an earn-hub task is verified (e.g. refresh points balance). */
  onPointsEarned?: () => void;
}) {
  const t = usePlatformT();
  const isEarnHub = quest.questKind === "EARN_HUB";
  const [submissions, setSubmissions] = useState<Record<string, QuestSubmission>>({});
  const [questCompleted, setQuestCompleted] = useState(false);
  const [allTasksVerified, setAllTasksVerified] = useState(false);
  const [rewardStatus, setRewardStatus] = useState<QuestRewardStatus | null>(null);
  const [rewardCc, setRewardCc] = useState<number | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [submittingQuest, setSubmittingQuest] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ledgerProof, setLedgerProof] = useState<QuestLedgerProof | null>(null);
  const [cantonLedgerConfigured, setCantonLedgerConfigured] = useState(false);
  const [partyId, setPartyId] = useState<string | null>(viewerPartyId);
  const [twitterUsername, setTwitterUsername] = useState<string | null>(
    viewerTwitterUsername,
  );
  const [campaignMeta, setCampaignMeta] = useState<CampaignMeta | null>(null);
  /** While a task is counting down or submitting, no other task can be started. */
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const firstOpenTaskIdx = useMemo(
    () => quest.tasks.findIndex((t) => submissions[t.id]?.status !== "VERIFIED"),
    [quest.tasks, submissions],
  );

  const isTaskSequentiallyLocked = useCallback(
    (taskIndex: number, taskId: string) => {
      if (firstOpenTaskIdx >= 0 && taskIndex !== firstOpenTaskIdx) return true;
      if (busyTaskId != null && busyTaskId !== taskId) return true;
      return false;
    },
    [firstOpenTaskIdx, busyTaskId],
  );

  const loadProgress = useCallback(() => {
    setProgressLoading(true);
    setProgressError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    fetch(`/api/quests/${quest.id}/progress`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = (await r.json()) as {
          completed?: boolean;
          allTasksVerified?: boolean;
          submissions?: QuestSubmission[];
          rewardStatus?: QuestRewardStatus;
          rewardCc?: number;
          cantonLedgerConfigured?: boolean;
          ledger?: QuestLedgerProof | null;
          campaignMeta?: CampaignMeta;
          message?: string;
        };
        if (!r.ok) {
          throw new Error(data.message ?? "Could not load quest progress");
        }
        setQuestCompleted(Boolean(data.completed));
        setAllTasksVerified(data.allTasksVerified ?? false);
        setCantonLedgerConfigured(Boolean(data.cantonLedgerConfigured));
        if (data.rewardStatus) setRewardStatus(data.rewardStatus);
        if (data.campaignMeta) setCampaignMeta(data.campaignMeta);
        if (data.completed) {
          setRewardCc(data.rewardCc ?? 0);
          if (data.ledger) setLedgerProof(data.ledger);
        }
        const map: Record<string, QuestSubmission> = {};
        for (const s of data.submissions ?? []) map[s.taskId] = s;
        setSubmissions(map);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof DOMException && err.name === "AbortError"
            ? "Request timed out — check API and login session"
            : err instanceof Error
              ? err.message
              : "Could not load quest progress";
        setProgressError(msg);
      })
      .finally(() => {
        clearTimeout(timeout);
        setProgressLoading(false);
      });
  }, [quest.id]);

  useEffect(() => {
    setPartyId(viewerPartyId);
  }, [viewerPartyId]);

  useEffect(() => {
    setTwitterUsername(viewerTwitterUsername);
  }, [viewerTwitterUsername]);

  useEffect(() => {
    loadProgress();
    fetch("/api/me", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (me: { cantonPartyId?: string | null; twitterUsername?: string | null } | null) => {
          if (viewerPartyId == null && hasRealWallet(me?.cantonPartyId)) {
            setPartyId(me!.cantonPartyId!.trim());
          }
          if (viewerTwitterUsername == null) {
            setTwitterUsername(me?.twitterUsername?.trim() || null);
          }
        },
      )
      .catch(() => {});
  }, [loadProgress, viewerPartyId, viewerTwitterUsername]);

  const verifiedCount = useMemo(
    () => quest.tasks.filter((t) => submissions[t.id]?.status === "VERIFIED").length,
    [quest.tasks, submissions],
  );
  const totalPoints = useMemo(
    () => quest.tasks.reduce((s, t) => s + t.points, 0),
    [quest.tasks],
  );
  const earnedPoints = useMemo(
    () =>
      quest.tasks.reduce(
        (s, t) => s + (submissions[t.id]?.status === "VERIFIED" ? t.points : 0),
        0,
      ),
    [quest.tasks, submissions],
  );
  const pct = quest.tasks.length ? Math.round((verifiedCount / quest.tasks.length) * 100) : 0;
  const allDone = verifiedCount === quest.tasks.length && quest.tasks.length > 0;
  const campaignEnded = !isEarnHub && isCampaignEnded(quest, campaignMeta);
  const fcfsSlotsFull =
    !isEarnHub &&
    Boolean(campaignMeta?.requiresFcfsClaim) &&
    isFcfsSlotsFull(campaignMeta?.remainingSlots, campaignMeta?.maxWinners);
  const userParticipated =
    verifiedCount > 0 ||
    questCompleted ||
    Object.keys(submissions).length > 0;
  const taskSubmissionsBlocked =
    campaignEnded || (fcfsSlotsFull && !userParticipated);
  const requiresFcfsClaim = campaignMeta?.requiresFcfsClaim ?? false;
  const requiresDrawCcClaim = campaignMeta?.requiresDrawCcClaim ?? false;
  const requiresPaidInviteClaim = campaignMeta?.requiresPaidInviteClaim ?? false;
  const showFcfsClaim =
    requiresFcfsClaim &&
    allDone &&
    !questCompleted &&
    !campaignEnded &&
    (campaignMeta?.remainingSlots ?? 0) > 0;
  const showInviteClaim =
    requiresPaidInviteClaim &&
    questCompleted &&
    !isEarnHub &&
    rewardStatus?.state === "fcfs_claimable" &&
    (campaignMeta?.codesRemaining ?? 0) > 0;
  const showCcDrawClaim =
    requiresDrawCcClaim &&
    questCompleted &&
    !isEarnHub &&
    rewardStatus?.state === "fcfs_claimable";
  // CC + Code combined raffle: winner selected by admin, pays 5 CC fee to claim both CC + code
  const showCcAndCodeRaffleClaim =
    quest.rewardType === "CC_AND_CODE_RAFFLE" &&
    questCompleted &&
    !isEarnHub &&
    rewardStatus?.state === "fcfs_claimable";
  const showClassicSubmit =
    allDone &&
    !questCompleted &&
    !isEarnHub &&
    !requiresFcfsClaim &&
    !campaignEnded;

  function onTaskVerified(taskId: string, sub: QuestSubmission) {
    setSubmissions((prev) => {
      const next = { ...prev, [taskId]: sub };
      const count = quest.tasks.filter((t) => next[t.id]?.status === "VERIFIED").length;
      setAllTasksVerified(count === quest.tasks.length && quest.tasks.length > 0);
      return next;
    });
  }

  async function handleSubmitQuest() {
    setSubmittingQuest(true);
    setSubmitError(null);
    setLedgerProof(null);

    try {
      const res = await fetch(`/api/quests/${quest.id}/submit`, {
        method: "POST",
        credentials: "include",
      });
      let data: {
        ok?: boolean;
        message?: string;
        rewardCc?: number;
        rewardStatus?: QuestRewardStatus;
        ledger?: QuestLedgerProof;
      } = {};
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setSubmitError(
          res.status === 504
            ? "Canton submit is slow — wait a few seconds, then press Submit again."
            : "Unexpected response — please try again.",
        );
        return;
      }
      if (!res.ok || !data.ok) {
        setSubmitError(
          data.message ??
            (res.status === 504
              ? "Canton submit timed out — try Submit again in a few seconds."
              : "Quest submit failed"),
        );
        return;
      }
      setQuestCompleted(true);
      setRewardCc(data.rewardCc ?? 0);
      if (data.rewardStatus) setRewardStatus(data.rewardStatus);
      if (data.ledger) setLedgerProof(data.ledger);
      loadProgress();
    } catch {
      setSubmitError("Network error — check API is running and try again.");
    } finally {
      setSubmittingQuest(false);
    }
  }

  if (progressLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)]/50 py-16">
        <LoadingSpinner size="xl" tone="muted" />
      </div>
    );
  }

  if (progressError && !isEarnHub) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-8 text-center">
        <p className="text-sm font-medium text-red-300">{progressError}</p>
        <button
          type="button"
          onClick={() => loadProgress()}
          className={cn(buttonVariants({ size: "sm" }), "mt-4")}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isEarnHub && progressError ? (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-xs text-orange-200">
          Could not load your progress — tasks are shown below.{" "}
          <button
            type="button"
            onClick={() => loadProgress()}
            className="font-semibold underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}
      {campaignEnded ? (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-200">
          {t("quests.campaignEndedClosed")}
        </div>
      ) : null}
      {fcfsSlotsFull && !campaignEnded && !isEarnHub ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3 text-sm text-[var(--muted-foreground)]">
          {userParticipated
            ? t("earnCampaigns.slotsFullBanner")
            : t("earnCampaigns.slotsFullClosedBanner")}
        </div>
      ) : null}

      {/* Missions header with live progress — consistent for all quest types */}
      {quest.tasks.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-[#0a0c14]/60 px-4 py-4 backdrop-blur-2xl sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">Missions</h2>
            </div>
            <span className="text-xs font-bold tabular-nums text-slate-400">
              {verifiedCount}/{quest.tasks.length} done
              {totalPoints > 0 ? (
                <span className="ml-2 text-canton">
                  +{earnedPoints}/{totalPoints} pts
                </span>
              ) : null}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                allDone
                  ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                  : "bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)]",
              )}
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Task list — satu container untuk Earn hub & campaign (markup identik). */}
      <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[var(--card)] backdrop-blur-2xl shadow-2xl shadow-black/40">
        <ul className="divide-y divide-white/[0.05]">
          {quest.tasks.map((task, idx) => (
            <TaskRow
              key={task.id}
              index={idx + 1}
              questId={quest.id}
              quest={quest}
              task={task}
              submission={submissions[task.id] ?? null}
              partyId={partyId}
              twitterUsername={twitterUsername}
              campaignEnded={taskSubmissionsBlocked}
              sequentiallyLocked={isTaskSequentiallyLocked(idx, task.id)}
              onBusyChange={(busy) =>
                setBusyTaskId((prev) => (busy ? task.id : prev === task.id ? null : prev))
              }
              earnHubLayout={isEarnHub}
              onPointsEarned={onPointsEarned}
              onVerified={(sub) => onTaskVerified(task.id, sub)}
            />
          ))}
        </ul>
      </div>

      {showFcfsClaim ? (
        <CampaignFcfsClaimSection
          questId={quest.id}
          partyId={partyId}
          rewardCc={quest.rewardCc}
          campaignMeta={campaignMeta!}
          onClaimed={() => loadProgress()}
        />
      ) : null}

      {showInviteClaim && campaignMeta ? (
        <CampaignInviteClaimSection
          questId={quest.id}
          partyId={partyId}
          campaignMeta={campaignMeta}
          rewardType={quest.rewardType}
          onClaimed={() => loadProgress()}
        />
      ) : null}

      {showCcDrawClaim && campaignMeta ? (
        <CampaignDrawCcClaimSection
          questId={quest.id}
          partyId={partyId}
          rewardCc={quest.rewardCc}
          campaignMeta={campaignMeta}
          onClaimed={() => loadProgress()}
        />
      ) : null}

      {showCcAndCodeRaffleClaim && campaignMeta ? (
        <CampaignCcAndCodeRaffleClaimSection
          questId={quest.id}
          partyId={partyId}
          rewardCc={quest.rewardCc}
          rewardVariant={rewardStatus?.rewardVariant ?? null}
          campaignMeta={campaignMeta}
          onClaimed={() => loadProgress()}
        />
      ) : null}

      {showClassicSubmit ? (
        <QuestSubmitSection
          partyId={partyId}
          submitting={submittingQuest}
          submitError={submitError}
          cantonLedgerConfigured={cantonLedgerConfigured}
          campaignEnded={campaignEnded}
          onSubmit={() => void handleSubmitQuest()}
        />
      ) : null}

      {allDone && !questCompleted && isEarnHub ? (
        <p className="text-center text-sm text-[var(--muted-foreground)]">
          All tasks done — points are in your balance above.
        </p>
      ) : null}

      {questCompleted && !isEarnHub && !showCcDrawClaim && !showInviteClaim && !showCcAndCodeRaffleClaim && (
        <QuestSubmittedProof
          rewardCc={rewardCc}
          rewardStatus={rewardStatus}
          ledger={ledgerProof}
          rewardType={quest.rewardType}
          campaignMeta={campaignMeta}
        />
      )}

      {!questCompleted &&
        !isEarnHub &&
        requiresFcfsClaim &&
        allDone &&
        !showFcfsClaim &&
        rewardStatus?.state === "fcfs_missed" ? (
        <QuestSubmittedProof
          rewardCc={rewardCc}
          rewardStatus={rewardStatus}
          ledger={ledgerProof}
          rewardType={quest.rewardType}
          campaignMeta={campaignMeta}
        />
      ) : null}
    </div>
  );
}

function TaskRow({
  index,
  questId,
  quest,
  task,
  submission,
  partyId,
  twitterUsername = null,
  campaignEnded = false,
  earnHubLayout = false,
  sequentiallyLocked = false,
  onBusyChange,
  onPointsEarned,
  onVerified,
}: {
  index: number;
  questId: string;
  quest: Quest;
  task: QuestTask;
  submission: QuestSubmission | null;
  partyId: string | null;
  twitterUsername?: string | null;
  campaignEnded?: boolean;
  earnHubLayout?: boolean;
  sequentiallyLocked?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onPointsEarned?: () => void;
  onVerified: (sub: QuestSubmission) => void;
}) {
  const taskType = normalizeType(task.type);
  const isPartyTask =
    taskType === "submit_party_id" || taskType === "submit_canton_address";
  const isEmailTask = taskType === "submit_email";
  const isQuiz = isEarnHubQuizType(taskType);
  const isQuizChoice = taskType === "quiz_choice";
  const isQuizYesNo = taskType === "quiz_yes_no";
  const isDailyCheckIn = taskType === "daily_check_in";
  const quizChoices = isQuizChoice ? parseQuizChoices(task.target) : [];

  const [proof, setProof] = useState(
    submission?.proof ?? (isPartyTask && partyId ? partyId : ""),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [quizPending, setQuizPending] = useState<string | null>(null);
  const [quizWrong, setQuizWrong] = useState<string | null>(null);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const [walletPromptOpen, setWalletPromptOpen] = useState(false);
  const [accountSubmitLocked, setAccountSubmitLocked] = useState(false);
  const autoSubmitFired = useRef(false);

  useEffect(() => {
    const busy = loading || (countdown !== null && countdown > 0);
    onBusyChange?.(busy);
  }, [loading, countdown, onBusyChange]);

  useEffect(() => {
    return () => onBusyChange?.(false);
  }, [onBusyChange]);

  const isAccountDataTask =
    isEmailTask ||
    isPartyTask ||
    taskType === "twitter_follow" ||
    taskType === "twitter_retweet" ||
    taskType === "telegram_channel" ||
    taskType === "telegram_group" ||
    taskType === "discord_join";

  /** Quest hub (/quest): wallet only for party-ID tasks. Partner campaigns (/earn): wallet required. */
  const needsWallet = earnHubLayout
    ? isPartyTask && !hasRealWallet(partyId)
    : !hasRealWallet(partyId);

  function requireWallet(): boolean {
    if (!needsWallet) return false;
    setWalletPromptOpen(true);
    return true;
  }

  const isTwitterTask = isTwitterTaskType(taskType);
  const needsTwitter = isTwitterTask && !twitterUsername;

  function requireTwitter(): boolean {
    if (!needsTwitter) return false;
    return true;
  }

  const isVerified = submission?.status === "VERIFIED";
  const isPending = submission?.status === "PENDING";
  const isRepeatable = earnHubLayout && isEarnHubRepeatableTask(task);
  const repeatCooldownMs = isRepeatable
    ? getEarnHubRepeatCooldownMs(submission, cooldownNow)
    : 0;
  const onRepeatCooldown = isRepeatable && isVerified && repeatCooldownMs > 0;
  const canRepeatNow = isRepeatable && isVerified && repeatCooldownMs === 0;
  const isOneTimeComplete = isVerified && !isRepeatable;

  useEffect(() => {
    if (!onRepeatCooldown) return;
    const t = setInterval(() => setCooldownNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [onRepeatCooldown, submission?.verifiedAt, submission?.submittedAt]);

  useEffect(() => {
    if (isPartyTask && partyId && !submission?.proof) {
      setProof(partyId);
    }
  }, [isPartyTask, partyId, submission?.proof]);

  useEffect(() => {
    if (countdown === null || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => (c !== null && c > 0 ? c - 1 : 0)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const canComplete =
    isQuiz || isDailyCheckIn
      ? Boolean(proof.trim())
      : countdown === 0 &&
        started &&
        (!isEmailTask || proof.trim().includes("@")) &&
        (!isPartyTask || proof.includes("::"));

  function startTask() {
    if (sequentiallyLocked) return;
    if (requireWallet()) return;
    if (requireTwitter()) return;
    if (isPartyTask && !partyId) return;
    if (isDailyCheckIn) {
      if (onRepeatCooldown) return;
      autoSubmitFired.current = false;
      setProof("checked_in");
      setStarted(true);
      setCountdown(0);
      setError(null);
      setSuccessMsg(null);
      return;
    }
    if (isQuiz) return;
    if (!isEmailTask && !isPartyTask) {
      openTaskTarget(task, taskType);
    }
    autoSubmitFired.current = false;
    setStarted(true);
    setCountdown(TASK_COUNTDOWN_SEC);
    setError(null);
  }

  async function submitQuizAnswer(answer: string) {
    if (sequentiallyLocked) return;
    if (requireWallet()) return;
    if (loading || isVerified || quizExpired) return;
    setQuizPending(answer);
    setQuizWrong(null);
    setError(null);
    setSuccessMsg(null);
    await handleSubmit(answer, { isQuiz: true });
  }

  async function handleSubmit(proofValue?: string, opts?: { isQuiz?: boolean }) {
    if (loading || campaignEnded) return;
    if (isAccountDataTask && accountSubmitLocked && !isRepeatable) return;
    if (countdown !== null && countdown > 0) return;
    if (isAccountDataTask && !opts?.isQuiz) setAccountSubmitLocked(true);
    setLoading(true);
    if (!opts?.isQuiz) {
      setError(null);
      setSuccessMsg(null);
    }
    try {
      const body = { proof: proofValue ?? proof ?? undefined };
      const res = await fetch(`/api/quests/${questId}/tasks/${task.id}/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        status?: string;
        message?: string;
      };

      if (!res.ok || data.ok === false) {
        const msg = parseApiErrorMessage(data);
        if (isAccountDataTask && !opts?.isQuiz) setAccountSubmitLocked(false);
        if (opts?.isQuiz && proofValue) {
          setQuizWrong(proofValue);
          setQuizPending(null);
          setError(msg.includes("Incorrect") ? msg : "Incorrect — try another answer.");
        } else {
          setError(msg);
        }
        return;
      }

      const status = (data.status ?? "VERIFIED") as SubmissionStatus;
      if (status !== "VERIFIED") {
        setError("Submitted for review — wait for approval.");
        return;
      }

      const finalProof = proofValue ?? proof ?? null;
      setProof(finalProof ?? "");
      setQuizWrong(null);
      setQuizPending(null);

      const nowIso = new Date().toISOString();
      const fakeSub: QuestSubmission = {
        id: submission?.id ?? "local",
        taskId: task.id,
        status: "VERIFIED",
        proof: finalProof,
        submittedAt: nowIso,
        verifiedAt: nowIso,
      };
      onVerified(fakeSub);
      onPointsEarned?.();
      setCooldownNow(Date.now());
      setSuccessMsg(
        isDailyCheckIn || isRepeatable
          ? `+${task.points} pts! Come back in 24 hours for more.`
          : "Correct! Points awarded.",
      );
      setStarted(false);
      setCountdown(null);
    } catch {
      if (isAccountDataTask && !opts?.isQuiz) setAccountSubmitLocked(false);
      if (opts?.isQuiz) {
        setQuizPending(null);
      }
      setError("Network error — please try again");
    } finally {
      setLoading(false);
      if (opts?.isQuiz) {
        setQuizPending(null);
      }
    }
  }

  useEffect(() => {
    if (isQuiz || isDailyCheckIn) return;
    if (
      !isVerified &&
      started &&
      countdown === 0 &&
      !loading &&
      canComplete &&
      !autoSubmitFired.current
    ) {
      autoSubmitFired.current = true;
      void handleSubmit();
    }
  }, [countdown, started, isVerified, loading, canComplete, isQuiz, isDailyCheckIn]);

  useEffect(() => {
    if (!isDailyCheckIn || loading || onRepeatCooldown) return;
    if (isVerified && !canRepeatNow) return;
    if (started && countdown === 0 && proof && !autoSubmitFired.current) {
      autoSubmitFired.current = true;
      void handleSubmit("checked_in");
    }
  }, [
    isDailyCheckIn,
    started,
    countdown,
    proof,
    isVerified,
    loading,
    onRepeatCooldown,
    canRepeatNow,
  ]);

  const needsProofBeforeStart = isEmailTask || isPartyTask;
  const actionLabel = taskActionButtonLabel(task.type);
  const actionDisabled =
    campaignEnded ||
    sequentiallyLocked ||
    loading ||
    (isAccountDataTask && accountSubmitLocked && !isRepeatable) ||
    needsTwitter ||
    (isPartyTask && needsWallet) ||
    (needsProofBeforeStart && !proof.trim()) ||
    (isEmailTask && !proof.includes("@"));

  const lockedHint =
    sequentiallyLocked && !isVerified ? "Complete previous tasks first (one at a time)" : null;

  const quizExpired = earnHubLayout && isQuiz && !isVerified && isEarnHubQuizExpired(task);

  const displayTitle = resolveQuestTaskDisplayTitle(task, quest);

  const earnHubDisplay = earnHubLayout
    ? getEarnHubTaskRowDisplay(task, {
        taskCompleted: isOneTimeComplete || onRepeatCooldown,
      })
    : null;

  // Jalur campaign — kartu standalone, SATU baris: [icon] [title+meta] [button].
  // Tombol sejajar dengan icon & title (kanan), tidak menabrak teks.
  // Jalur Earn-hub ditangani blok di bawah (butuh earnHubDisplay).
  if (!(earnHubLayout && earnHubDisplay)) {
    return (
      <li
        className={cn(
          "rounded-2xl border bg-[var(--card)] p-4 transition-all duration-200 sm:p-5",
          isVerified
            ? "border-emerald-500/30 bg-emerald-500/[0.06]"
            : "border-white/[0.06] hover:border-[var(--primary)]/30",
          sequentiallyLocked && !isVerified && "opacity-55",
        )}
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <TaskBrandIcon type={task.type} complete={isVerified} />

          <div className="min-w-0 flex-1">
            {/* Garis atas: jumlah pts (highlight). */}
            <p
              className={cn(
                "mb-0.5 text-xs font-bold tabular-nums",
                isVerified ? "text-emerald-400" : "text-amber-300",
              )}
            >
              +{task.points} pts
            </p>
            <p
              className={cn(
                "truncate text-sm font-semibold leading-snug text-slate-100 sm:text-base",
                isVerified && "line-through opacity-70",
              )}
            >
              {displayTitle}
            </p>
            {/* Baris meta: petunjuk aksi/target atau deskripsi (truncate agar rapi). */}
            {(() => {
              const actionHint = taskActionHint(task, task.type);
              const desc =
                task.description &&
                !task.description.trim().startsWith("http") &&
                task.description.trim() !== (task.target ?? "").trim()
                  ? task.description.trim()
                  : null;
              const meta = desc ?? actionHint;
              return meta ? (
                <p className="mt-0.5 truncate text-xs font-medium text-[var(--muted-foreground)]">
                  {meta}
                </p>
              ) : null;
            })()}
            {lockedHint ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {lockedHint}
              </p>
            ) : null}
          </div>

          {/* Kotak hijau kanan = tombol status task (sejajar, shrink-0 = tidak nabrak). */}
          <div className="flex shrink-0 items-center">
            {sequentiallyLocked && !isVerified ? (
              <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1 rounded-lg bg-[var(--muted)]/30 px-3 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                <Lock className="h-3 w-3" aria-hidden />
                Locked
              </span>
            ) : isVerified ? (
              <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 text-xs font-bold text-[var(--primary-foreground)]">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                Complete
              </span>
            ) : countdown !== null && countdown > 0 ? (
              <span
                className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-emerald-500/15 px-4 text-center text-xs font-bold tabular-nums text-emerald-300"
                aria-live="polite"
              >
                {formatTaskCountdownSeconds(countdown)}
              </span>
            ) : loading ? (
              <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-emerald-500/20">
                <LoadingSpinner size="sm" />
              </span>
            ) : isPending ? (
              <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-orange-500/15 px-4 text-xs font-bold text-orange-200">
                Pending
              </span>
            ) : (
              <button
                type="button"
                disabled={actionDisabled}
                onClick={startTask}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "h-9 min-w-[5.5rem] bg-emerald-500 px-4 font-bold hover:bg-emerald-400",
                )}
              >
                {actionLabel}
              </button>
            )}
          </div>
        </div>

        {!isVerified && isQuizYesNo ? (
          <div className="mt-3 flex rounded-full bg-[var(--muted)]/35 p-1 sm:ml-[3.25rem]">
            {(["yes", "no"] as const).map((opt) => {
              const key = quizAnswerKey(opt, taskType);
              const isWrong = quizWrong !== null && quizAnswerKey(quizWrong, taskType) === key;
              const isPendingBtn =
                loading && quizPending !== null && quizAnswerKey(quizPending, taskType) === key;
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={loading || sequentiallyLocked}
                  onClick={() => void submitQuizAnswer(opt)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm font-medium capitalize transition-colors",
                    sequentiallyLocked && "cursor-not-allowed opacity-50",
                    isWrong
                      ? "bg-red-500/15 text-red-300"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]",
                  )}
                >
                  {isPendingBtn ? <LoadingSpinner size="sm" /> : null}
                  {opt}
                </button>
              );
            })}
          </div>
        ) : null}

        {!isVerified && isQuizChoice && quizChoices.length > 0 ? (
          <ul className="mt-3 space-y-1.5 sm:ml-[3.25rem]">
            {quizChoices.map((label, idx) => {
              const letter = String.fromCharCode(65 + idx);
              const key = quizAnswerKey(letter, taskType);
              const isWrong = quizWrong !== null && quizAnswerKey(quizWrong, taskType) === key;
              const isPendingBtn =
                loading && quizPending !== null && quizAnswerKey(quizPending, taskType) === key;
              return (
                <li key={letter}>
                  <button
                    type="button"
                    disabled={loading || sequentiallyLocked}
                    onClick={() => void submitQuizAnswer(letter)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl bg-[var(--muted)]/25 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]/35",
                      isWrong
                        ? "bg-red-500/10 text-red-200 hover:bg-red-500/15"
                        : "text-[var(--foreground)]",
                    )}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold bg-[var(--muted)] text-[var(--muted-foreground)]">
                      {isPendingBtn ? <LoadingSpinner size="xs" /> : letter}
                    </span>
                    <span>{label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {!isVerified && isEmailTask ? (
          <div className="mt-3 sm:ml-[3.25rem]">
            <input
              type="email"
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              placeholder="your@email.com"
              disabled={loading || isVerified}
              className="w-full max-w-md rounded-full bg-[var(--muted)]/35 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
        ) : null}

        {!isVerified && isPartyTask ? (
          <div className="mt-3 sm:ml-[3.25rem]">
            {needsWallet ? (
              <button
                type="button"
                onClick={() => setWalletPromptOpen(true)}
                className="w-full max-w-md rounded-full bg-orange-500/10 px-4 py-2.5 text-left text-xs text-orange-300"
              >
                Create wallet to verify →
              </button>
            ) : (
              <input
                type="text"
                value={proof}
                readOnly
                disabled
                className="w-full max-w-md rounded-full bg-[var(--muted)]/30 px-4 py-2.5 font-mono text-xs text-[var(--muted-foreground)]"
              />
            )}
          </div>
        ) : null}

        {needsTwitter && !isVerified ? (
          <p className="mt-2 text-xs text-orange-300/90 sm:ml-[3.25rem]">
            <Link href="/settings" className="font-semibold underline underline-offset-2">
              Connect X
            </Link>{" "}
            in Settings first.
          </p>
        ) : null}

        {error ? <p className="mt-2 text-xs text-red-400 sm:ml-[3.25rem]">{error}</p> : null}
        {successMsg && !error ? (
          <p className="mt-2 text-xs font-medium text-emerald-400 sm:ml-[3.25rem]">{successMsg}</p>
        ) : null}

        <WalletCreatePromptModal
          open={walletPromptOpen}
          onClose={() => setWalletPromptOpen(false)}
        />
      </li>
    );
  }

  if (earnHubLayout && earnHubDisplay) {
    return (
      <li
        className={cn(
          "rounded-2xl border bg-[var(--card)] p-4 transition-all duration-200 sm:p-5",
          isOneTimeComplete || onRepeatCooldown
            ? "border-emerald-500/30 bg-emerald-500/[0.06]"
            : "border-white/[0.06] hover:border-[var(--primary)]/30",
          sequentiallyLocked && !isVerified && "opacity-55",
        )}
      >
        <div className="flex gap-3 sm:gap-4">
          <TaskBrandIcon
            type={task.type}
            complete={isOneTimeComplete || onRepeatCooldown}
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <p
                    className={cn(
                      "text-sm font-semibold leading-snug text-slate-100 sm:text-base",
                      isOneTimeComplete && "line-through opacity-70",
                    )}
                  >
                    {earnHubDisplay.headline}
                  </p>
                  {earnHubDisplay.showNew ? (
                    <span className="shrink-0 rounded-lg bg-canton/20 px-2 py-1 text-xs font-bold uppercase tracking-wide text-canton">
                      New
                    </span>
                  ) : null}
                </div>
              </div>
              <TaskPointsLabel
                points={task.points}
                complete={isOneTimeComplete || onRepeatCooldown}
              />
            </div>
            {isOneTimeComplete ? (
              <p className="mt-2 text-sm font-medium text-emerald-400/80">Completed</p>
            ) : null}
            {onRepeatCooldown ? (
              <p className="mt-2 text-sm font-medium text-emerald-400/80">
                Checked in — available again in {formatEarnHubCooldown(repeatCooldownMs)}
              </p>
            ) : null}
            {canRepeatNow ? (
              <p className="mt-2 text-sm font-medium text-canton">
                Ready again — check in for +{task.points} pts
              </p>
            ) : null}

            {quizExpired ? (
              <p className="mt-3 text-sm font-medium text-orange-300/90">
                Quiz ended — points were only available for 24 hours. Your balance is unchanged if
                you did not complete it in time.
              </p>
            ) : null}

            {!isVerified && !quizExpired && isQuiz ? (
              <p className="mt-3 text-sm font-medium text-slate-400">
                Wrong answers earn no points — keep trying until you pick the correct one (within
                24 hours).
              </p>
            ) : null}

            {!isVerified && !quizExpired && isQuizYesNo ? (
              <div className="mt-3 flex rounded-full bg-[var(--muted)]/35 p-1">
                {(["yes", "no"] as const).map((opt) => {
                  const key = quizAnswerKey(opt, taskType);
                  const isWrong = quizWrong !== null && quizAnswerKey(quizWrong, taskType) === key;
                  const isPending =
                    loading && quizPending !== null && quizAnswerKey(quizPending, taskType) === key;
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={loading || quizExpired || sequentiallyLocked}
                      onClick={() => void submitQuizAnswer(opt)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm font-medium capitalize transition-colors",
                        (quizExpired || sequentiallyLocked) && "cursor-not-allowed opacity-50",
                        isWrong
                          ? "bg-red-500/15 text-red-300"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--background)]/50 hover:text-[var(--foreground)]",
                      )}
                    >
                      {isPending ? <LoadingSpinner size="sm" /> : null}
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {!isVerified && !quizExpired && isQuizChoice && quizChoices.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {quizChoices.map((label, idx) => {
                  const letter = String.fromCharCode(65 + idx);
                  const key = quizAnswerKey(letter, taskType);
                  const isWrong = quizWrong !== null && quizAnswerKey(quizWrong, taskType) === key;
                  const isPending =
                    loading && quizPending !== null && quizAnswerKey(quizPending, taskType) === key;
                  return (
                    <li key={letter}>
                      <button
                        type="button"
                        disabled={loading || quizExpired || sequentiallyLocked}
                        onClick={() => void submitQuizAnswer(letter)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl bg-[var(--muted)]/25 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]/35",
                          quizExpired && "cursor-not-allowed opacity-50",
                          isWrong
                            ? "bg-red-500/10 text-red-200 hover:bg-red-500/15"
                            : "text-[var(--foreground)]",
                        )}
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--muted)] text-[10px] font-bold text-[var(--muted-foreground)]">
                          {isPending ? <LoadingSpinner size="xs" /> : letter}
                        </span>
                        <span className="leading-snug">{label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {!isQuiz && (!isVerified || canRepeatNow) && !onRepeatCooldown ? (
              <div className="mt-3">
                {countdown !== null && countdown > 0 ? (
                  <div className="flex justify-end">
                    <span
                      className="min-w-[6.5rem] rounded-full bg-canton/10 px-3 py-2 text-center text-xs font-semibold tabular-nums text-canton"
                      aria-live="polite"
                    >
                      {formatTaskCountdownSeconds(countdown)}
                    </span>
                  </div>
                ) : sequentiallyLocked ? (
                  <div className="flex justify-end">
                    <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1 rounded-full bg-[var(--muted)]/30 px-3 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                      <Lock className="h-3 w-3" aria-hidden />
                      Locked
                    </span>
                  </div>
                ) : loading ? (
                  <div className="flex justify-end">
                    <span className="flex h-9 min-w-[5.5rem] items-center justify-center rounded-full bg-[var(--muted)]/40">
                      <LoadingSpinner size="sm" />
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={actionDisabled}
                    onClick={startTask}
                    className={cn(
                      buttonVariants({ size: "sm" }),
                      "h-9 w-full font-bold disabled:opacity-50",
                    )}
                  >
                    {isDailyCheckIn
                      ? canRepeatNow
                        ? "Check in again"
                        : "Check in"
                      : actionLabel}
                  </button>
                )}
              </div>
            ) : null}

            {needsTwitter && !isVerified ? (
              <p className="mt-2 text-[11px] text-orange-300/90">
                <Link href="/settings" className="font-semibold underline underline-offset-2">
                  Connect X (Twitter)
                </Link>{" "}
                in Settings to verify follow and retweet tasks.
              </p>
            ) : null}

            {needsWallet && !isVerified ? (
              <button
                type="button"
                onClick={() => setWalletPromptOpen(true)}
                className="mt-2 text-left text-[11px] font-medium text-orange-300/90 underline-offset-2 hover:underline"
              >
                Create your wallet to complete this task →
              </button>
            ) : null}
            {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
          </div>
        </div>
        <WalletCreatePromptModal
          open={walletPromptOpen}
          onClose={() => setWalletPromptOpen(false)}
        />
      </li>
    );
  }
}


type SubmissionStatus = "PENDING" | "VERIFIED" | "REJECTED";
