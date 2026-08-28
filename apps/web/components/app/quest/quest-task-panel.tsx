"use client";

import type {
  Quest,
  QuestTask,
  QuestSubmission,
  QuestRewardStatus,
  SubmissionStatus,
} from "@/lib/quest/quest-types";
import {
  TASK_ACTION_BUTTON_LABEL,
  TASK_COUNTDOWN_SEC,
  formatTaskCountdownSeconds,
  resolveQuestTaskDisplayTitle,
  formatQuestHubCooldown,
  getQuestHubRepeatCooldownMs,
  getQuestHubTaskRowDisplay,
  isQuestHubQuizExpired,
  isQuestHubQuizType,
  isQuestHubRepeatableTask,
  isSendTransactionTask,
  isSendTokenTask,
  isDailySwapTask,
  isCountBasedDailyTask,
  isLockCcTask,
  parseQuizChoices,
} from "@/lib/quest/quest-types";
import { CampaignFcfsClaimSection } from "@/components/app/campaign/campaign-fcfs-claim";
import { CampaignDrawCcClaimSection } from "@/components/app/campaign/campaign-draw-cc-claim";
import { CampaignCcAndCodeRaffleClaimSection } from "@/components/app/campaign/campaign-cc-and-code-raffle-claim";
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
import { Lock } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useMe } from "@/lib/hooks/use-me";
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
    if (Array.isArray(message) && typeof message[0] === "string")
      return message[0];
  }
  return "Submission failed";
}

function quizAnswerKey(answer: string, taskType: string): string {
  return taskType === "quiz_choice"
    ? answer.trim().toUpperCase()
    : answer.trim().toLowerCase();
}

function taskActionButtonLabel(type: string): string {
  const key = normalizeType(type);
  return (
    TASK_ACTION_BUTTON_LABEL[key] ?? TASK_ACTION_BUTTON_LABEL[type] ?? "Open"
  );
}

/**
 * Baris meta di bawah judul mission: petunjuk aksi ringkas + target (mis. handle /
 * link channel). Menggantikan label platform redundan lama (info platform sudah
 * ada di ikon + judul). Kembalikan null bila tidak ada yang berguna ditampilkan.
 */

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
  const isQuestHub = quest.questKind === "EARN_HUB";
  const [submissions, setSubmissions] = useState<
    Record<string, QuestSubmission>
  >({});
  const [questCompleted, setQuestCompleted] = useState(false);
  const [, setAllTasksVerified] = useState(false);
  const [rewardStatus, setRewardStatus] = useState<QuestRewardStatus | null>(
    null,
  );
  const [rewardCc, setRewardCc] = useState<number | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState<string | null>(null);
  /** True setelah data progress pertama berhasil turun. Polling background setelah
   *  ini bersifat silent (no spinner) → mencegah flicker tiap 10s. */
  const progressDoneFirstLoad = useRef(false);
  const [submittingQuest, setSubmittingQuest] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ledgerProof, setLedgerProof] = useState<QuestLedgerProof | null>(null);
  const [cantonLedgerConfigured, setCantonLedgerConfigured] = useState(false);
  // TaskIds verified within the last 24h (rolling window) — drives the accurate
  // progress bar that mirrors the rolling-24h cooldown gate, instead of the
  // all-time VERIFIED status.
  const [todayVerified, setTodayVerified] = useState<Set<string>>(new Set());
  const [partyId, setPartyId] = useState<string | null>(viewerPartyId);
  const [twitterUsername, setTwitterUsername] = useState<string | null>(
    viewerTwitterUsername,
  );
  const [campaignMeta, setCampaignMeta] = useState<CampaignMeta | null>(null);
  /** taskId → { required, today } live progress for send-transaction tasks. */
  const [sendProgress, setSendProgress] = useState<
    Record<string, { required: number; today: number }>
  >({});
  /** While a task is counting down or submitting, no other task can be started. */
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // Ticks every minute so quizzes that cross the 24h boundary disappear live
  // (without a full page reload). Points already earned stay in the balance.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // On the Quest hub, hide quizzes that ended (>24h since publish) entirely.
  // Points users earned are already credited to their balance and are not removed.
  const visibleTasks = useMemo(
    () =>
      isQuestHub
        ? quest.tasks.filter((t) => !isQuestHubQuizExpired(t, now))
        : quest.tasks,
    [isQuestHub, quest.tasks, now],
  );

  const firstOpenTaskIdx = useMemo(
    () =>
      visibleTasks.findIndex((t) => submissions[t.id]?.status !== "VERIFIED"),
    [visibleTasks, submissions],
  );

  const isTaskSequentiallyLocked = useCallback(
    (taskIndex: number, taskId: string) => {
      if (firstOpenTaskIdx >= 0 && taskIndex !== firstOpenTaskIdx) return true;
      if (busyTaskId != null && busyTaskId !== taskId) return true;
      return false;
    },
    [firstOpenTaskIdx, busyTaskId],
  );

  const loadProgress = useCallback(
    (opts?: { silent?: boolean }) => {
      // `silent` = poll background / event-driven refetch → JANGANGGAL flip spinner.
      // Hanya first-load (sebelum data pertama turun) yang menampilkan loading,
      // persis seperti dApp: spinner sekali, lalu update diam-diam. Ini memperbaiki
      // bug flicker 10s di mana seluruh panel collapse jadi spinner tiap poll.
      if (!opts?.silent || !progressDoneFirstLoad.current) {
        setProgressLoading(true);
      }
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
            sendProgress?: Record<string, { required: number; today: number }>;
            todayVerifiedTaskIds?: string[];
            message?: string;
          };
          if (!r.ok) {
            throw new Error(data.message ?? "Could not load quest progress");
          }
          setQuestCompleted(Boolean(data.completed));
          setAllTasksVerified(data.allTasksVerified ?? false);
          setCantonLedgerConfigured(Boolean(data.cantonLedgerConfigured));
          setTodayVerified(new Set(data.todayVerifiedTaskIds ?? []));
          if (data.rewardStatus) setRewardStatus(data.rewardStatus);
          if (data.campaignMeta) setCampaignMeta(data.campaignMeta);
          if (data.sendProgress) setSendProgress(data.sendProgress);
          if (data.completed) {
            setRewardCc(data.rewardCc ?? 0);
            if (data.ledger) setLedgerProof(data.ledger);
          }
          const map: Record<string, QuestSubmission> = {};
          for (const s of data.submissions ?? []) map[s.taskId] = s;
          setSubmissions(map);
          progressDoneFirstLoad.current = true;
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
    },
    [quest.id],
  );

  useEffect(() => {
    setPartyId(viewerPartyId);
  }, [viewerPartyId]);

  // Reset first-load flag saat quest berubah (jika panel dipertahankan tanpa
  // remount) → spinner tampil untuk quest baru, bukan blank.
  useEffect(() => {
    progressDoneFirstLoad.current = false;
  }, [quest.id]);

  useEffect(() => {
    setTwitterUsername(viewerTwitterUsername);
  }, [viewerTwitterUsername]);

  // Profil user (GET /api/me) via cache global `useMe`. Request ter-dedup
  // dengan konsumen lain (dashboard, settings, earn-hub, dll) — sebelumnya
  // panel ini mem-fetch `/api/me` sendiri tiap mount (duplikat dengan parent
  // earn-hub yang sudah pass props).
  const { me: meProfile } = useMe();
  useEffect(() => {
    if (viewerPartyId == null && hasRealWallet(meProfile?.cantonPartyId)) {
      setPartyId(meProfile!.cantonPartyId!.trim());
    }
    if (viewerTwitterUsername == null) {
      setTwitterUsername(meProfile?.twitterUsername?.trim() || null);
    }
  }, [meProfile, viewerPartyId, viewerTwitterUsername]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  // ── Realtime progress for send-transaction tasks ──────────────────────────
  // Progress "3/5 sends" diperbarui via polling 10s (pause saat tab hidden +
  // refetch instan saat tab kembali visible). Bell notifikasi sekarang
  // sinkron via invalidateQueries (bukan event bus manual) — polling tetap
  // jadi sumber update agar progres naik tanpa interaksi user.
  // Poll progress bila quest punya task countable-wallet (send/swap) yang belum selesai.
  const hasUnresolvedCountableWalletTask = useMemo(
    () =>
      visibleTasks.some(
        (t) =>
          (isSendTransactionTask(t.type) ||
            isSendTokenTask(t.type) ||
            isDailySwapTask(t.type)) &&
          submissions[t.id]?.status !== "VERIFIED",
      ),
    [visibleTasks, submissions],
  );

  // SSE live di PlatformShell emit "cq:realtime" (status koneksi) dan
  // "cq:progress"/"cq:quest-progress" (event quest:progress dari server).
  // Selama SSE hidup, progress di-refresh instan via event dan interval poll
  // di bawah hanya jadi watchdog longgar (60s). Saat SSE putus → kembali 10s.
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  useEffect(() => {
    const onRealtime = (e: Event) => {
      const detail = (e as CustomEvent<{ connected?: boolean }>).detail;
      setRealtimeConnected(Boolean(detail?.connected));
    };
    const onQuestProgress = () => {
      void loadProgress({ silent: true });
    };
    window.addEventListener("cq:realtime", onRealtime);
    window.addEventListener("cq:quest-progress", onQuestProgress);
    return () => {
      window.removeEventListener("cq:realtime", onRealtime);
      window.removeEventListener("cq:quest-progress", onQuestProgress);
    };
  }, [loadProgress]);

  useEffect(() => {
    if (!hasUnresolvedCountableWalletTask) return;
    const POLL_MS = realtimeConnected ? 60_000 : 10_000;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (intervalId) clearInterval(intervalId);
      // Poll SILENT — no spinner flicker (bug lama: panel collapse tiap 10s).
      intervalId = setInterval(() => {
        void loadProgress({ silent: true });
      }, POLL_MS);
    };
    const stopPoll = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    startPoll();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadProgress({ silent: true });
        startPoll();
      } else {
        stopPoll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopPoll();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hasUnresolvedCountableWalletTask, realtimeConnected, loadProgress]);

  const verifiedCount = useMemo(
    () =>
      visibleTasks.filter((t) => submissions[t.id]?.status === "VERIFIED")
        .length,
    [visibleTasks, submissions],
  );
  // Rolling-24h progress: tasks verified within the last 24h. Mirrors the
  // rolling-24h cooldown gate. The all-time `verifiedCount`/`allDone` are kept
  // for CAMPAIGN, but EARN_HUB uses this rolling variant for accurate progress.
  const verifiedTodayCount = useMemo(
    () => visibleTasks.filter((t) => todayVerified.has(t.id)).length,
    [visibleTasks, todayVerified],
  );
  // Progress bar dihapus (campaign detail + quest hub) — jumlah task sudah
  // terwakili metric tile / status per-task (permintaan user, anti-duplikat).
  const allDone = isQuestHub
    ? verifiedTodayCount === visibleTasks.length && visibleTasks.length > 0
    : verifiedCount === visibleTasks.length && visibleTasks.length > 0;
  const campaignEnded = !isQuestHub && isCampaignEnded(quest, campaignMeta);
  const fcfsSlotsFull =
    !isQuestHub &&
    Boolean(campaignMeta?.requiresFcfsClaim) &&
    isFcfsSlotsFull(campaignMeta?.remainingSlots, campaignMeta?.maxWinners);
  const userParticipated =
    verifiedCount > 0 || questCompleted || Object.keys(submissions).length > 0;
  const taskSubmissionsBlocked =
    campaignEnded || (fcfsSlotsFull && !userParticipated);
  const requiresFcfsClaim = campaignMeta?.requiresFcfsClaim ?? false;
  const requiresDrawCcClaim = campaignMeta?.requiresDrawCcClaim ?? false;
  const requiresPaidInviteClaim =
    campaignMeta?.requiresPaidInviteClaim ?? false;
  const showFcfsClaim =
    requiresFcfsClaim &&
    allDone &&
    !questCompleted &&
    !campaignEnded &&
    (campaignMeta?.remainingSlots ?? 0) > 0;
  const showInviteClaim =
    requiresPaidInviteClaim &&
    questCompleted &&
    !isQuestHub &&
    rewardStatus?.state === "fcfs_claimable" &&
    (campaignMeta?.codesRemaining ?? 0) > 0;
  const showCcDrawClaim =
    requiresDrawCcClaim &&
    questCompleted &&
    !isQuestHub &&
    rewardStatus?.state === "fcfs_claimable";
  // CC + Code combined raffle: winner selected by admin, pays claim fee to receive CC + code
  const showCcAndCodeRaffleClaim =
    quest.rewardType === "CC_AND_CODE_RAFFLE" &&
    questCompleted &&
    !isQuestHub &&
    rewardStatus?.state === "fcfs_claimable";
  const showClassicSubmit =
    allDone &&
    !questCompleted &&
    !isQuestHub &&
    !requiresFcfsClaim &&
    !campaignEnded;

  function onTaskVerified(taskId: string, sub: QuestSubmission) {
    setSubmissions((prev) => {
      const next = { ...prev, [taskId]: sub };
      const count = visibleTasks.filter(
        (t) => next[t.id]?.status === "VERIFIED",
      ).length;
      setAllTasksVerified(
        count === visibleTasks.length && visibleTasks.length > 0,
      );
      return next;
    });
    // Mirror the per-day progress: a fresh verification always belongs to today.
    if (sub.status === "VERIFIED") {
      setTodayVerified((prev) => {
        if (prev.has(taskId)) return prev;
        const next = new Set(prev);
        next.add(taskId);
        return next;
      });
    }
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

  if (progressError && !isQuestHub) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-8 text-center">
        <p className="text-sm font-medium text-red-600">{progressError}</p>
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
      {isQuestHub && progressError ? (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-xs text-orange-600">
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
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600">
          {t("quests.campaignEndedClosed")}
        </div>
      ) : null}
      {fcfsSlotsFull && !campaignEnded && !isQuestHub ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3 text-sm text-[var(--muted-foreground)]">
          {userParticipated
            ? t("earnCampaigns.slotsFullBanner")
            : t("earnCampaigns.slotsFullClosedBanner")}
        </div>
      ) : null}

      {/* Task list — Quest hub & campaign sama-sama quest-timeline (dots +
          guide line, gaya Earn Campaign); info khas hub (cooldown/New badge/
          quiz) tetap tampil di dalam kartu. */}
      <ul className="quest-timeline">
        {visibleTasks.map((task, idx) => (
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
            sendProgress={sendProgress[task.id]}
            onBusyChange={(busy) =>
              setBusyTaskId((prev) =>
                busy ? task.id : prev === task.id ? null : prev,
              )
            }
            questHubLayout={isQuestHub}
            onPointsEarned={onPointsEarned}
            onVerified={(sub) => onTaskVerified(task.id, sub)}
          />
        ))}
      </ul>

      {showFcfsClaim ? (
        <CampaignFcfsClaimSection
          questId={quest.id}
          partyId={partyId}
          rewardCc={quest.rewardCc}
          rewardToken={quest.rewardToken}
          campaignMeta={campaignMeta!}
          questOrg={quest.org}
          questTitle={quest.title}
          onClaimed={() => loadProgress()}
        />
      ) : null}

      {showInviteClaim && campaignMeta ? (
        <CampaignInviteClaimSection
          questId={quest.id}
          partyId={partyId}
          campaignMeta={campaignMeta}
          rewardType={quest.rewardType}
          questOrg={quest.org}
          questTitle={quest.title}
          onClaimed={() => loadProgress()}
        />
      ) : null}

      {showCcDrawClaim && campaignMeta ? (
        <CampaignDrawCcClaimSection
          questId={quest.id}
          partyId={partyId}
          rewardCc={quest.rewardCc}
          rewardToken={quest.rewardToken}
          campaignMeta={campaignMeta}
          questOrg={quest.org}
          questTitle={quest.title}
          onClaimed={() => loadProgress()}
        />
      ) : null}

      {showCcAndCodeRaffleClaim && campaignMeta ? (
        <CampaignCcAndCodeRaffleClaimSection
          questId={quest.id}
          partyId={partyId}
          rewardCc={quest.rewardCc}
          rewardVariant={rewardStatus?.rewardVariant ?? null}
          rewardToken={quest.rewardToken}
          campaignMeta={campaignMeta}
          questOrg={quest.org}
          questTitle={quest.title}
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

      {allDone && !questCompleted && isQuestHub ? (
        <p className="text-center text-sm text-[var(--muted-foreground)]">
          All tasks done — points are in your balance above.
        </p>
      ) : null}

      {questCompleted &&
        !isQuestHub &&
        !showCcDrawClaim &&
        !showInviteClaim &&
        !showCcAndCodeRaffleClaim && (
          <QuestSubmittedProof
            rewardCc={rewardCc}
            rewardStatus={rewardStatus}
            ledger={ledgerProof}
            rewardType={quest.rewardType}
            rewardToken={quest.rewardToken}
            campaignMeta={campaignMeta}
            redeemUrl={quest.redeemUrl}
            redeemInstructions={quest.redeemInstructions}
          />
        )}

      {!questCompleted &&
      !isQuestHub &&
      requiresFcfsClaim &&
      allDone &&
      !showFcfsClaim &&
      rewardStatus?.state === "fcfs_missed" ? (
        <QuestSubmittedProof
          rewardCc={rewardCc}
          rewardStatus={rewardStatus}
          ledger={ledgerProof}
          rewardType={quest.rewardType}
          rewardToken={quest.rewardToken}
          campaignMeta={campaignMeta}
          redeemUrl={quest.redeemUrl}
          redeemInstructions={quest.redeemInstructions}
        />
      ) : null}
    </div>
  );
}

function TaskRow({
  questId,
  quest,
  task,
  submission,
  partyId,
  twitterUsername = null,
  campaignEnded = false,
  questHubLayout = false,
  sequentiallyLocked = false,
  sendProgress,
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
  questHubLayout?: boolean;
  sequentiallyLocked?: boolean;
  sendProgress?: { required: number; today: number };
  onBusyChange?: (busy: boolean) => void;
  onPointsEarned?: () => void;
  onVerified: (sub: QuestSubmission) => void;
}) {
  const taskType = normalizeType(task.type);
  const isPartyTask =
    taskType === "submit_party_id" || taskType === "submit_canton_address";
  const isEmailTask = taskType === "submit_email";
  const isQuiz = isQuestHubQuizType(taskType);
  const isQuizChoice = taskType === "quiz_choice";
  const isQuizYesNo = taskType === "quiz_yes_no";
  const isDailyCheckIn = taskType === "daily_check_in";
  const isSendTx = isSendTransactionTask(taskType);
  const isSendToken = isSendTokenTask(taskType);
  const isDailySwap = isDailySwapTask(taskType);
  const isCountDaily = isCountBasedDailyTask(taskType);
  const isLockCc = isLockCcTask(taskType);
  // Countable wallet tasks share the same flow: wallet-required → auto-submit
  // → backend re-counts real on-chain activity since 00:00 UTC (the lookback
  // window is calendar-anchored; the claim cooldown itself is rolling 24h).
  const isCountableWalletTask =
    isSendTx || isSendToken || isDailySwap || isCountDaily;
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

  /** Quest hub (/quest): wallet only for party-ID + countable wallet tasks (send/swap/lock). Partner campaigns (/earn): wallet required. */
  const needsWallet = questHubLayout
    ? (isPartyTask || isCountableWalletTask || isLockCc) &&
      !hasRealWallet(partyId)
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
  const isRepeatable = questHubLayout && isQuestHubRepeatableTask(task);
  const repeatCooldownMs = isRepeatable
    ? getQuestHubRepeatCooldownMs(submission, cooldownNow)
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
    const t = setTimeout(
      () => setCountdown((c) => (c !== null && c > 0 ? c - 1 : 0)),
      1000,
    );
    return () => clearTimeout(t);
  }, [countdown]);

  const canComplete =
    isQuiz || isDailyCheckIn || isCountableWalletTask || isLockCc
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
    if (isDailyCheckIn || isCountableWalletTask || isLockCc) {
      if (onRepeatCooldown) return;
      autoSubmitFired.current = false;
      setProof(
        isSendTx
          ? "sent_tx"
          : isSendToken
            ? "sent_token"
            : isDailySwap
              ? "swapped"
              : isLockCc
                ? "locked_cc"
                : "checked_in",
      );
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

  async function handleSubmit(
    proofValue?: string,
    opts?: { isQuiz?: boolean },
  ) {
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
      const res = await fetch(
        `/api/quests/${questId}/tasks/${task.id}/submit`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
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
          setError(
            msg.includes("Incorrect") ? msg : "Incorrect — try another answer.",
          );
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
    if (isQuiz || isDailyCheckIn || isCountableWalletTask || isLockCc) return;
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
  }, [
    countdown,
    started,
    isVerified,
    loading,
    canComplete,
    isQuiz,
    isDailyCheckIn,
    isCountableWalletTask,
    isLockCc,
  ]);

  useEffect(() => {
    if (
      (!isDailyCheckIn && !isCountableWalletTask && !isLockCc) ||
      loading ||
      onRepeatCooldown
    )
      return;
    if (isVerified && !canRepeatNow) return;
    if (started && countdown === 0 && proof && !autoSubmitFired.current) {
      autoSubmitFired.current = true;
      void handleSubmit(
        isSendTx
          ? "sent_tx"
          : isSendToken
            ? "sent_token"
            : isDailySwap
              ? "swapped"
              : isLockCc
                ? "locked_cc"
                : "checked_in",
      );
    }
  }, [
    isDailyCheckIn,
    isCountableWalletTask,
    isLockCc,
    isSendTx,
    isSendToken,
    isDailySwap,
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
    sequentiallyLocked && !isVerified
      ? "Complete previous tasks first (one at a time)"
      : null;

  const quizExpired =
    questHubLayout && isQuiz && !isVerified && isQuestHubQuizExpired(task);

  const displayTitle = resolveQuestTaskDisplayTitle(task, quest);

  const questHubDisplay = questHubLayout
    ? getQuestHubTaskRowDisplay(task, {
        taskCompleted: isOneTimeComplete || onRepeatCooldown,
      })
    : null;

  // Jalur campaign — kartu standalone, SATU baris: [icon] [title+meta] [button].
  // Tombol sejajar dengan icon & title (kanan), tidak menabrak teks.
  // quest-milestone = dot timeline di kiri (is-done = emerald, is-active = pulse).
  // Jalur Earn-hub ditangani blok di bawah (butuh questHubDisplay).
  if (!(questHubLayout && questHubDisplay)) {
    return (
      <li
        className={cn(
          "quest-milestone rounded-2xl border bg-[var(--card)] p-4 transition-all duration-200 sm:p-5",
          isVerified
            ? "is-done border-emerald-500/30 bg-emerald-500/[0.06]"
            : sequentiallyLocked
              ? "border-[var(--border)] opacity-50"
              : "is-active border-[var(--border)] hover:border-[var(--primary)]/30",
        )}
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <TaskBrandIcon type={task.type} complete={isVerified} />

          <div className="min-w-0 flex-1">
            {/* Garis atas: jumlah pts (highlight). */}
            <p
              className={cn(
                "mb-0.5 text-xs font-bold tabular-nums",
                isVerified ? "text-emerald-600" : "text-amber-600",
              )}
            >
              +{task.points} pts
            </p>
            <p
              className={cn(
                "line-clamp-2 break-words text-sm font-semibold leading-snug text-[var(--foreground)] sm:text-base",
                isVerified && "line-through opacity-70",
              )}
            >
              {displayTitle}
            </p>
            {lockedHint ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
                <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {lockedHint}
              </p>
            ) : null}
          </div>

          {/* Kotak kanan = tombol status task (sejajar, shrink-0 = tidak nabrak).
              Mockup detail: Verified = chip emerald lembut. */}
          <div className="flex shrink-0 items-center">
            {sequentiallyLocked && !isVerified ? (
              <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1 rounded-lg bg-[var(--muted)]/30 px-3 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                <Lock className="h-3 w-3" aria-hidden />
                Locked
              </span>
            ) : isVerified ? (
              <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-emerald-500/15 px-4 text-xs font-bold text-emerald-600">
                Verified
              </span>
            ) : countdown !== null && countdown > 0 ? (
              <span
                className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-emerald-500/15 px-4 text-center text-xs font-bold tabular-nums text-emerald-600"
                aria-live="polite"
              >
                {formatTaskCountdownSeconds(countdown)}
              </span>
            ) : loading ? (
              <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-emerald-500/20">
                <LoadingSpinner size="sm" />
              </span>
            ) : isPending ? (
              <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-orange-500/15 px-4 text-xs font-bold text-orange-600">
                Pending
              </span>
            ) : (
              <button
                type="button"
                disabled={actionDisabled}
                onClick={startTask}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "h-9 min-w-[5.5rem] px-4 font-bold",
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
              const isWrong =
                quizWrong !== null &&
                quizAnswerKey(quizWrong, taskType) === key;
              const isPendingBtn =
                loading &&
                quizPending !== null &&
                quizAnswerKey(quizPending, taskType) === key;
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
                      ? "bg-red-500/15 text-red-600"
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
              const isWrong =
                quizWrong !== null &&
                quizAnswerKey(quizWrong, taskType) === key;
              const isPendingBtn =
                loading &&
                quizPending !== null &&
                quizAnswerKey(quizPending, taskType) === key;
              return (
                <li key={letter}>
                  <button
                    type="button"
                    disabled={loading || sequentiallyLocked}
                    onClick={() => void submitQuizAnswer(letter)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl bg-[var(--muted)]/25 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--muted)]/35",
                      isWrong
                        ? "bg-red-500/10 text-red-600 hover:bg-red-500/15"
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
                className="w-full max-w-md rounded-full bg-orange-500/10 px-4 py-2.5 text-left text-xs text-orange-600"
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
          <p className="mt-2 text-xs text-orange-600/90 sm:ml-[3.25rem]">
            <Link
              href="/settings"
              className="font-semibold underline underline-offset-2"
            >
              Connect X
            </Link>{" "}
            in Settings first.
          </p>
        ) : null}

        {error ? (
          <p className="mt-2 text-xs text-red-600 sm:ml-[3.25rem]">{error}</p>
        ) : null}
        {successMsg && !error ? (
          <p className="mt-2 text-xs font-medium text-emerald-600 sm:ml-[3.25rem]">
            {successMsg}
          </p>
        ) : null}

        <WalletCreatePromptModal
          open={walletPromptOpen}
          onClose={() => setWalletPromptOpen(false)}
        />
      </li>
    );
  }

  if (questHubLayout && questHubDisplay) {
    // is-done = tuntas one-time ATAU repeatable yang masih cooldown;
    // is-active = task yang bisa dikerjakan sekarang (termasuk ready-again).
    const hubDone = (isOneTimeComplete || onRepeatCooldown) && !canRepeatNow;
    return (
      <li
        className={cn(
          "quest-milestone rounded-2xl border bg-[var(--card)] p-4 transition-all duration-200 sm:p-5",
          hubDone
            ? "is-done border-emerald-500/30 bg-emerald-500/[0.06]"
            : sequentiallyLocked
              ? "border-[var(--border)] opacity-50"
              : "is-active border-[var(--border)] hover:border-[var(--primary)]/30",
        )}
      >
        <>
          <div className="flex items-center gap-3 sm:gap-4">
            <TaskBrandIcon
              type={task.type}
              complete={isOneTimeComplete || onRepeatCooldown}
            />

            <div className="min-w-0 flex-1">
              {/* Garis atas: jumlah pts (highlight) — sama dengan path campaign. */}
              <p
                className={cn(
                  "mb-0.5 text-xs font-bold tabular-nums",
                  isOneTimeComplete || onRepeatCooldown
                    ? "text-emerald-600"
                    : "text-amber-600",
                )}
              >
                +{task.points} pts
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={cn(
                    "line-clamp-2 break-words text-sm font-semibold leading-snug text-[var(--foreground)] sm:text-base",
                    isOneTimeComplete && "line-through opacity-70",
                  )}
                >
                  {questHubDisplay.headline}
                </p>
                {questHubDisplay.showNew ? (
                  <span className="shrink-0 rounded-md bg-canton/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-canton">
                    New
                  </span>
                ) : null}
              </div>
              {/* Baris status meta ringkas (cooldown / ready / quiz ended / send progress). */}
              {onRepeatCooldown ? (
                <p className="mt-0.5 break-words text-xs font-medium text-emerald-600/80">
                  {isCountableWalletTask || isLockCc
                    ? "Verified"
                    : "Checked in"}{" "}
                  — ready in {formatQuestHubCooldown(repeatCooldownMs)}
                </p>
              ) : canRepeatNow && isCountableWalletTask ? (
                <p className="mt-0.5 break-words text-xs font-medium text-canton">
                  Ready — verify for +{task.points} pts
                </p>
              ) : canRepeatNow ? (
                <p className="mt-0.5 break-words text-xs font-medium text-canton">
                  Ready again — check in for +{task.points} pts
                </p>
              ) : quizExpired ? (
                <p className="mt-0.5 break-words text-xs font-medium text-orange-600/90">
                  Quiz ended
                </p>
              ) : null}
              {isCountableWalletTask && sendProgress ? (
                <p className="mt-0.5 break-words text-xs font-medium text-[var(--muted-foreground)]">
                  {sendProgress.today}/{sendProgress.required}{" "}
                  {isDailySwap
                    ? "swaps"
                    : taskType === "lock_cc_daily"
                      ? "locks"
                      : isCountDaily
                        ? "transactions"
                        : "sends"}{" "}
                  today
                </p>
              ) : null}
            </div>

            {/* Kotak kanan = tombol status (sama dengan path campaign):
              Verified = chip emerald lembut; cooldown countdown = chip mono. */}
            {!isQuiz && (
              <div className="flex shrink-0 items-center">
                {sequentiallyLocked && !isVerified ? (
                  <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1 rounded-lg bg-[var(--muted)]/30 px-3 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                    <Lock className="h-3 w-3" aria-hidden />
                    Locked
                  </span>
                ) : (isOneTimeComplete || onRepeatCooldown) && !canRepeatNow ? (
                  <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-emerald-500/15 px-4 text-xs font-bold text-emerald-600">
                    Verified
                  </span>
                ) : countdown !== null && countdown > 0 ? (
                  <span
                    className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-emerald-500/15 px-4 text-center text-xs font-bold tabular-nums text-emerald-600"
                    aria-live="polite"
                  >
                    {formatTaskCountdownSeconds(countdown)}
                  </span>
                ) : loading ? (
                  <span className="inline-flex h-9 min-w-[5.5rem] items-center justify-center rounded-lg bg-emerald-500/20">
                    <LoadingSpinner size="sm" />
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={actionDisabled || quizExpired}
                    onClick={startTask}
                    className={cn(
                      buttonVariants({ size: "sm" }),
                      "h-9 min-w-[5.5rem] px-4 font-bold",
                    )}
                  >
                    {isDailyCheckIn
                      ? canRepeatNow
                        ? "Check in"
                        : "Check in"
                      : actionLabel}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Quiz blocks (yes/no + choice) tetap di bawah — hanya muncul utk task quiz. */}
          {!isVerified && !quizExpired && isQuizYesNo ? (
            <div className="mt-3 flex rounded-full bg-[var(--muted)]/35 p-1">
              {(["yes", "no"] as const).map((opt) => {
                const key = quizAnswerKey(opt, taskType);
                const isWrong =
                  quizWrong !== null &&
                  quizAnswerKey(quizWrong, taskType) === key;
                const isPending =
                  loading &&
                  quizPending !== null &&
                  quizAnswerKey(quizPending, taskType) === key;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={loading || quizExpired || sequentiallyLocked}
                    onClick={() => void submitQuizAnswer(opt)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm font-medium capitalize transition-colors",
                      (quizExpired || sequentiallyLocked) &&
                        "cursor-not-allowed opacity-50",
                      isWrong
                        ? "bg-red-500/15 text-red-600"
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

          {!isVerified &&
          !quizExpired &&
          isQuizChoice &&
          quizChoices.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {quizChoices.map((label, idx) => {
                const letter = String.fromCharCode(65 + idx);
                const key = quizAnswerKey(letter, taskType);
                const isWrong =
                  quizWrong !== null &&
                  quizAnswerKey(quizWrong, taskType) === key;
                const isPending =
                  loading &&
                  quizPending !== null &&
                  quizAnswerKey(quizPending, taskType) === key;
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
                          ? "bg-red-500/10 text-red-600 hover:bg-red-500/15"
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

          {needsTwitter && !isVerified ? (
            <p className="mt-2 text-xs text-orange-600/90">
              <Link
                href="/settings"
                className="font-semibold underline underline-offset-2"
              >
                Connect X (Twitter)
              </Link>{" "}
              in Settings to verify follow and retweet tasks.
            </p>
          ) : null}

          {needsWallet && !isVerified ? (
            <button
              type="button"
              onClick={() => setWalletPromptOpen(true)}
              className="mt-2 text-left text-xs font-medium text-orange-600/90 underline-offset-2 hover:underline"
            >
              Create your wallet to complete this task →
            </button>
          ) : null}
          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        </>
        <WalletCreatePromptModal
          open={walletPromptOpen}
          onClose={() => setWalletPromptOpen(false)}
        />
      </li>
    );
  }
}
