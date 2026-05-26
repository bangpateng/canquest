"use client";

import type {
  Quest,
  QuestTask,
  QuestTaskType,
  QuestSubmission,
  QuestRewardStatus,
} from "@/lib/quest-types";
import {
  TASK_ACTION_BUTTON_LABEL,
  TASK_COUNTDOWN_SEC,
  formatEarnHubCooldown,
  getEarnHubRepeatCooldownMs,
  getEarnHubTaskRowDisplay,
  isEarnHubQuizExpired,
  isEarnHubQuizType,
  isEarnHubRepeatableTask,
  isEarnHubSocialType,
  parseQuizChoices,
} from "@/lib/quest-types";
import { CampaignFcfsClaimSection } from "@/components/app/campaign-fcfs-claim";
import { CampaignInviteClaimSection } from "@/components/app/campaign-invite-claim";
import {
  QuestSubmitSection,
  QuestSubmittedProof,
  type QuestLedgerProof,
} from "@/components/app/quest-submit-section";
import {
  type CampaignMeta,
  isCampaignEnded,
  isFcfsSlotsFull,
} from "@/lib/campaign-reward";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { WalletCreatePromptModal } from "@/components/app/wallet-create-prompt";
import { CardTitle, SectionTitle, SubsectionTitle } from "@/components/ui/typography";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hasRealWallet } from "@/lib/wallet-access";
import { CalendarCheck, Check, CheckCircle2, Circle, Fingerprint, HelpCircle, Mail, Repeat2, Send, UserPlus, Users, Zap } from "lucide-react";
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

function TaskIcon({ type, className }: { type: string; className?: string }) {
  const common = cn("h-5 w-5 shrink-0", className);
  const t = normalizeType(type);
  switch (t as QuestTaskType) {
    case "twitter_follow":
      return <UserPlus className={common} aria-hidden />;
    case "twitter_retweet":
      return <Repeat2 className={common} aria-hidden />;
    case "telegram_channel":
    case "telegram_group":
      return <Send className={common} aria-hidden />;
    case "discord_join":
      return <Users className={common} aria-hidden />;
    case "submit_email":
      return <Mail className={common} aria-hidden />;
    case "submit_party_id":
    case "submit_canton_address":
      return <Fingerprint className={common} aria-hidden />;
    case "daily_check_in" as QuestTaskType:
      return <CalendarCheck className={common} aria-hidden />;
    case "quiz_yes_no" as QuestTaskType:
    case "quiz_choice" as QuestTaskType:
      return <HelpCircle className={common} aria-hidden />;
    default:
      return <Circle className={common} aria-hidden />;
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
          This campaign has ended. New task submissions and claims are disabled.
        </div>
      ) : null}
      {fcfsSlotsFull && !campaignEnded && !isEarnHub ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3 text-sm text-[var(--muted-foreground)]">
          {userParticipated
            ? t("earnCampaigns.slotsFullBanner")
            : t("earnCampaigns.slotsFullClosedBanner")}
        </div>
      ) : null}

      {!isEarnHub ? (
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border p-5 md:p-6",
            allDone
              ? "border-[var(--primary)]/40 bg-gradient-to-br from-[var(--primary)]/12 to-transparent shadow-[0_0_32px_rgb(var(--canton-rgb)/0.08)]"
              : "border-[var(--border)] bg-[var(--card)]/80",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "type-section-title flex h-12 w-12 items-center justify-center rounded-xl",
                  allDone
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_0_20px_rgb(var(--canton-rgb)/0.3)]"
                    : "bg-[var(--muted)] text-[var(--muted-foreground)]",
                )}
              >
                {pct}%
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Mission progress
                </p>
                <SubsectionTitle>
                  {verifiedCount} / {quest.tasks.length} verified
                </SubsectionTitle>
                <p className="text-xs text-[var(--muted-foreground)]">
                  +{earnedPoints} / {totalPoints} points
                </p>
              </div>
            </div>
            {allDone && !questCompleted && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/15 px-3 py-1 text-xs font-bold text-canton">
                <Zap className="h-3.5 w-3.5" />
                Ready to submit
              </span>
            )}
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--muted)] ring-1 ring-[var(--border)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--primary-strong)] transition-all duration-700 ease-out shadow-[0_0_12px_rgb(var(--canton-rgb)/0.5)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Task list */}
      {isEarnHub ? (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/40">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--muted)]/20 px-4 py-3 sm:px-5">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">Tasks to complete</p>
            <p className="text-xs font-semibold tabular-nums text-[var(--foreground)]">
              {verifiedCount}/{quest.tasks.length}
            </p>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {quest.tasks.map((task, idx) => (
              <TaskRow
                key={task.id}
                index={idx + 1}
                questId={quest.id}
                task={task}
                submission={submissions[task.id] ?? null}
                partyId={partyId}
                twitterUsername={twitterUsername}
                campaignEnded={taskSubmissionsBlocked}
                earnHubLayout
                onPointsEarned={onPointsEarned}
                onVerified={(sub) => onTaskVerified(task.id, sub)}
              />
            ))}
          </ul>
        </div>
      ) : (
        <ol className="relative space-y-4">
          {quest.tasks.map((task, idx) => (
            <li key={task.id} className="relative">
              {idx < quest.tasks.length - 1 ? (
                <span
                  className="absolute left-[1.65rem] top-14 bottom-0 w-px bg-gradient-to-b from-[var(--border)] to-transparent"
                  aria-hidden
                />
              ) : null}
              <TaskRow
                index={idx + 1}
                questId={quest.id}
                task={task}
                submission={submissions[task.id] ?? null}
                partyId={partyId}
                twitterUsername={twitterUsername}
                campaignEnded={taskSubmissionsBlocked}
                onVerified={(sub) => onTaskVerified(task.id, sub)}
              />
            </li>
          ))}
        </ol>
      )}

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

      {questCompleted && !isEarnHub && (
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
  task,
  submission,
  partyId,
  twitterUsername = null,
  campaignEnded = false,
  earnHubLayout = false,
  onPointsEarned,
  onVerified,
}: {
  index: number;
  questId: string;
  task: QuestTask;
  submission: QuestSubmission | null;
  partyId: string | null;
  twitterUsername?: string | null;
  campaignEnded?: boolean;
  earnHubLayout?: boolean;
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
          ? `+${task.points} points! Come back in 24 hours for more.`
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
    loading ||
    (isAccountDataTask && accountSubmitLocked && !isRepeatable) ||
    needsTwitter ||
    (isPartyTask && needsWallet) ||
    (needsProofBeforeStart && !proof.trim()) ||
    (isEmailTask && !proof.includes("@"));

  const quizExpired = earnHubLayout && isQuiz && !isVerified && isEarnHubQuizExpired(task);

  const earnHubDisplay = earnHubLayout
    ? getEarnHubTaskRowDisplay(task, {
        taskCompleted: isOneTimeComplete || onRepeatCooldown,
      })
    : null;

  if (earnHubLayout && earnHubDisplay) {
    return (
      <li
        className={cn(
          "px-4 py-4 transition-colors sm:px-5 sm:py-4",
          isOneTimeComplete || onRepeatCooldown
            ? "bg-emerald-500/[0.025]"
            : "hover:bg-[var(--muted)]/15",
        )}
      >
        <div className="flex gap-3">
          <div className="relative shrink-0">
            <span
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl",
                isOneTimeComplete || onRepeatCooldown
                  ? "bg-emerald-500/12 text-emerald-400"
                  : "bg-[var(--muted)]/45 text-[var(--muted-foreground)]",
              )}
            >
              <TaskIcon type={task.type} className="h-4 w-4" />
            </span>
            {isOneTimeComplete || onRepeatCooldown ? (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-[var(--card)]">
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={cn(
                      "text-sm font-medium leading-snug text-[var(--foreground)]",
                      isOneTimeComplete && "text-[var(--muted-foreground)] line-through",
                    )}
                  >
                    {earnHubDisplay.headline}
                  </p>
                  {earnHubDisplay.showNew ? (
                    <span className="shrink-0 rounded-md bg-canton/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-canton">
                      New
                    </span>
                  ) : null}
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 text-xs font-semibold tabular-nums",
                  isOneTimeComplete || onRepeatCooldown ? "text-emerald-400/90" : "text-canton",
                )}
              >
                +{task.points}
              </span>
            </div>
            {isOneTimeComplete ? (
              <p className="mt-1 text-[11px] font-medium text-emerald-400/80">Completed</p>
            ) : null}
            {onRepeatCooldown ? (
              <p className="mt-1 text-[11px] font-medium text-emerald-400/80">
                Checked in — available again in {formatEarnHubCooldown(repeatCooldownMs)}
              </p>
            ) : null}
            {canRepeatNow ? (
              <p className="mt-1 text-[11px] text-canton">
                Ready again — check in for +{task.points} points
              </p>
            ) : null}

            {quizExpired ? (
              <p className="mt-2 text-[11px] text-orange-300/90">
                Quiz ended — points were only available for 24 hours. Your balance is unchanged if
                you did not complete it in time.
              </p>
            ) : null}

            {!isVerified && !quizExpired && isQuiz ? (
              <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                Wrong answers earn no points — keep trying until you pick the correct one (within
                24 hours).
              </p>
            ) : null}

            {!isVerified && !quizExpired && isQuizYesNo ? (
              <div className="mt-3 flex rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5">
                {(["yes", "no"] as const).map((opt) => {
                  const key = quizAnswerKey(opt, taskType);
                  const isWrong = quizWrong !== null && quizAnswerKey(quizWrong, taskType) === key;
                  const isPending =
                    loading && quizPending !== null && quizAnswerKey(quizPending, taskType) === key;
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={loading || quizExpired}
                      onClick={() => void submitQuizAnswer(opt)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium capitalize transition-colors",
                        quizExpired && "cursor-not-allowed opacity-50",
                        isWrong
                          ? "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/35"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]/30 hover:text-[var(--foreground)]",
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
                        disabled={loading || quizExpired}
                        onClick={() => void submitQuizAnswer(letter)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          quizExpired && "cursor-not-allowed opacity-50",
                          isWrong
                            ? "border-red-500/40 bg-red-500/10 text-red-200"
                            : "border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)]/25",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                            isWrong
                              ? "bg-red-500/25 text-red-200"
                              : "bg-[var(--muted)] text-[var(--muted-foreground)]",
                          )}
                        >
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
                  <p className="py-2 text-center text-xs text-[var(--muted-foreground)]">
                    Verifying… {countdown}s
                  </p>
                ) : loading ? (
                  <div className="flex h-9 items-center justify-center gap-2 text-xs text-[var(--muted-foreground)]">
                    <LoadingSpinner size="sm" />
                    Verifying…
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={actionDisabled}
                    onClick={startTask}
                    className={cn(
                      buttonVariants({ size: "sm" }),
                      "h-9 w-full rounded-lg font-medium disabled:opacity-50",
                    )}
                  >
                    {isDailyCheckIn
                      ? canRepeatNow
                        ? "Check in again"
                        : "Check in"
                      : isTwitterTask
                        ? countdown !== null && countdown > 0
                          ? `Open X · ${countdown}s`
                          : `Verify · ${actionLabel}`
                        : `Continue · ${actionLabel}`}
                  </button>
                )}
              </div>
            ) : null}

            {needsTwitter && !isVerified ? (
              <p className="mt-2 text-[11px] text-orange-300/90">
                <Link href="/setting#twitter" className="font-semibold underline underline-offset-2">
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

  return (
    <div
      className={cn(
        "group relative rounded-2xl border bg-[var(--card)]/90 p-5 transition-all duration-300 backdrop-blur-sm",
        isVerified &&
          "border-emerald-500/35 bg-gradient-to-br from-emerald-500/8 to-transparent ring-1 ring-emerald-500/20",
        isPending && "border-orange-500/30 bg-orange-500/5",
        !isVerified &&
          !isPending &&
          "border-[var(--border)] hover:border-[var(--primary)]/25 hover:shadow-[0_0_24px_rgb(var(--canton-rgb)/0.06)]",
      )}
    >
      <div className="flex gap-4">
        {/* Step badge */}
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl text-xs font-bold",
            isVerified
              ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
              : "bg-[var(--muted)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]",
          )}
        >
          {isVerified ? (
            <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} />
          ) : (
            <>
              <span className="text-[9px] uppercase opacity-60">Step</span>
              <span className="type-card-title leading-none">
                {index}
              </span>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              {!isVerified && (
                <span className="mt-0.5 text-[var(--muted-foreground)]">
                  <TaskIcon type={task.type} />
                </span>
              )}
              <div className="min-w-0">
                <CardTitle>{task.title}</CardTitle>
                {task.description &&
                  !task.description.trim().startsWith("http") &&
                  task.description.trim() !== (task.target ?? "").trim() && (
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {task.description}
                    </p>
                  )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isVerified ? (
                <>
                  <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                    Verified
                  </span>
                  <span className="rounded-lg bg-[var(--primary)]/15 px-2.5 py-1 text-xs font-bold tabular-nums text-canton">
                    +{task.points} pts
                  </span>
                </>
              ) : isQuiz ? null : countdown !== null && countdown > 0 ? (
                <button
                  type="button"
                  disabled
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "min-w-[5.5rem] rounded-full cursor-wait",
                  )}
                >
                  {countdown}s…
                </button>
              ) : loading ? (
                <button
                  type="button"
                  disabled
                  className={cn(buttonVariants({ size: "sm" }), "min-w-[5.5rem] rounded-full gap-2")}
                >
                  <LoadingSpinner size="md" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={actionDisabled}
                  onClick={startTask}
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "min-w-[5.5rem] rounded-full font-bold shadow-[0_0_16px_rgb(var(--canton-rgb)/0.15)]",
                  )}
                >
                  {actionLabel}
                </button>
              )}
            </div>
          </div>

          {!isVerified && isQuiz && (
            <p className="text-xs text-[var(--muted-foreground)]">
              Wrong answers earn no points — keep trying until you get it right.
            </p>
          )}

          {needsTwitter && !isVerified ? (
            <p className="text-xs text-orange-300/90">
              <Link href="/setting#twitter" className="font-semibold underline underline-offset-2">
                Connect X (Twitter)
              </Link>{" "}
              in Settings to verify this task.
            </p>
          ) : null}

          {!isVerified && isQuizYesNo && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {(["yes", "no"] as const).map((opt) => {
                  const key = quizAnswerKey(opt, taskType);
                  const isWrong = quizWrong !== null && quizAnswerKey(quizWrong, taskType) === key;
                  const isPending =
                    loading && quizPending !== null && quizAnswerKey(quizPending, taskType) === key;
                  return (
                    <button
                      key={opt}
                      type="button"
                      disabled={loading}
                      onClick={() => void submitQuizAnswer(opt)}
                      className={cn(
                        buttonVariants({
                          variant: isWrong ? "secondary" : "secondary",
                          size: "sm",
                        }),
                        "min-w-[4.5rem] rounded-full capitalize",
                        isWrong && "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/15",
                      )}
                    >
                      {isPending ? <LoadingSpinner size="sm" className="mr-1 inline" /> : null}
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!isVerified && isQuizChoice && quizChoices.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {quizChoices.map((label, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const key = quizAnswerKey(letter, taskType);
                const isWrong = quizWrong !== null && quizAnswerKey(quizWrong, taskType) === key;
                const isPending =
                  loading && quizPending !== null && quizAnswerKey(quizPending, taskType) === key;
                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={loading}
                    onClick={() => void submitQuizAnswer(letter)}
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                      "h-auto rounded-xl py-2.5 text-left text-xs font-semibold",
                      isWrong && "border-red-500/40 bg-red-500/10 text-red-200 hover:bg-red-500/15",
                    )}
                  >
                    {isPending ? (
                      <LoadingSpinner size="sm" className="mr-1 inline" />
                    ) : (
                      <span className="text-canton">{letter}.</span>
                    )}{" "}
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {!isVerified && isEmailTask && (
            <input
              type="email"
              value={proof}
              onChange={(e) => setProof(e.target.value)}
              placeholder="your@email.com"
              disabled={loading || isVerified}
              className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--muted)]/60 px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--primary)]/40 focus:ring-2 focus:ring-[var(--ring)]"
            />
          )}

          {!isVerified && isPartyTask && (
            <>
              {needsWallet ? (
                <button
                  type="button"
                  onClick={() => setWalletPromptOpen(true)}
                  className="w-full rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-left text-xs text-orange-300 hover:bg-orange-500/15"
                >
                  Create your wallet first to submit —{" "}
                  <span className="font-semibold underline">get started</span>
                </button>
              ) : (
                <input
                  type="text"
                  value={proof}
                  readOnly
                  disabled
                  className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 font-mono text-xs text-[var(--muted-foreground)]"
                />
              )}
            </>
          )}

          {error && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300">
                {error}
              </p>
              {started && countdown === 0 && canComplete ? (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    autoSubmitFired.current = false;
                    void handleSubmit();
                  }}
                  className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}
          {successMsg && !error && (
            <p className="text-xs font-semibold text-emerald-400">{successMsg}</p>
          )}
        </div>
      </div>
      <WalletCreatePromptModal
        open={walletPromptOpen}
        onClose={() => setWalletPromptOpen(false)}
      />
    </div>
  );
}

type SubmissionStatus = "PENDING" | "VERIFIED" | "REJECTED";
