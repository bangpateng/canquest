"use client";

import type { Quest, QuestTask, QuestTaskType, QuestSubmission } from "@/lib/quest-types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Fingerprint,
  HelpCircle,
  Mail,
  Loader2,
  Repeat2,
  Send,
  UserPlus,
  Users,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/* ── helpers ── */

const TASK_LABELS: Record<QuestTaskType, string> = {
  twitter_follow: "Twitter follow",
  twitter_retweet: "Retweet",
  telegram_join: "Telegram",
  discord_join: "Discord",
  submit_email: "Email",
  submit_canton_address: "Canton address",
  visit_website: "Visit site",
  quiz_choice: "Quiz",
};

function TaskIcon({ type }: { type: string }) {
  const common = "h-5 w-5 shrink-0";
  switch (type as QuestTaskType) {
    case "twitter_follow": return <UserPlus className={common} aria-hidden />;
    case "twitter_retweet": return <Repeat2 className={common} aria-hidden />;
    case "telegram_join": return <Send className={common} aria-hidden />;
    case "discord_join": return <Users className={common} aria-hidden />;
    case "submit_email": return <Mail className={common} aria-hidden />;
    case "submit_canton_address": return <Fingerprint className={common} aria-hidden />;
    case "visit_website": return <ExternalLink className={common} aria-hidden />;
    default: return <HelpCircle className={common} aria-hidden />;
  }
}

/* ── main component ── */

export function QuestTaskPanel({ quest }: { quest: Quest }) {
  const [submissions, setSubmissions] = useState<Record<string, QuestSubmission>>({});
  const [questCompleted, setQuestCompleted] = useState(false);
  const [rewardCc, setRewardCc] = useState<number | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);

  // Load existing progress from backend on mount
  useEffect(() => {
    let cancelled = false;
    setProgressLoading(true);
    fetch(`/api/quests/${quest.id}/progress`)
      .then((r) => r.json())
      .then(
        (data: { completed: boolean; submissions: QuestSubmission[] }) => {
          if (cancelled) return;
          setQuestCompleted(data.completed);
          const map: Record<string, QuestSubmission> = {};
          for (const s of data.submissions) map[s.taskId] = s;
          setSubmissions(map);
        },
      )
      .catch(() => {/* ignore */})
      .finally(() => { if (!cancelled) setProgressLoading(false); });
    return () => { cancelled = true; };
  }, [quest.id]);

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
  const allDone = verifiedCount === quest.tasks.length && quest.tasks.length > 0;

  function onTaskVerified(taskId: string, sub: QuestSubmission) {
    setSubmissions((prev) => ({ ...prev, [taskId]: sub }));
  }

  function onQuestComplete(reward: number) {
    setQuestCompleted(true);
    setRewardCc(reward);
  }

  if (progressLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div
        className={cn(
          "rounded-2xl border border-[var(--border)] bg-[var(--muted)]/30 p-5 transition-colors",
          allDone && quest.tasks.length > 0 && "border-[var(--primary)]/25 bg-[var(--primary)]/[0.06]",
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Progress
            </p>
            <p className="mt-1 font-[family-name:var(--font-space)] text-xl font-semibold text-[var(--foreground)]">
              {verifiedCount} / {quest.tasks.length} tasks
              <span className="ml-3 text-base font-normal text-[var(--muted-foreground)]">
                · +{earnedPoints} / {totalPoints} pts
              </span>
            </p>
          </div>
          <div className="relative h-2.5 flex-1 min-w-[140px] max-w-xs overflow-hidden rounded-full bg-[var(--border)] ring-1 ring-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--primary)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition-all duration-500 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]"
              style={{
                width: `${quest.tasks.length ? (verifiedCount / quest.tasks.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Task list */}
      <ol className="space-y-3">
        {quest.tasks.map((task, idx) => (
          <li key={task.id}>
            <TaskRow
              index={idx + 1}
              questId={quest.id}
              task={task}
              submission={submissions[task.id] ?? null}
              onVerified={(sub) => onTaskVerified(task.id, sub)}
              onQuestComplete={onQuestComplete}
            />
          </li>
        ))}
      </ol>

      {/* Quest completion banner */}
      {(allDone || questCompleted) && (
        <section
          className={cn(
            "rounded-2xl border p-6 shadow-sm",
            questCompleted
              ? "border-[var(--primary)]/35 bg-[var(--primary)]/[0.065]"
              : "border-[var(--border)] bg-[var(--card)]",
          )}
        >
          {questCompleted ? (
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)]/18 ring-1 ring-[var(--primary)]/30">
                <Trophy className="h-7 w-7 text-[var(--foreground)]" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="font-[family-name:var(--font-space)] text-lg font-semibold text-[var(--foreground)]">
                  Quest Completed!
                </p>
                {rewardCc !== null && rewardCc > 0 ? (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {rewardCc} CC reward has been sent to your wallet.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    Your Proof of Execution has been recorded on the Canton ledger.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <h4 className="font-[family-name:var(--font-space)] text-lg font-semibold text-[var(--foreground)]">
                All tasks verified
              </h4>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                Submit any remaining task above to finalize your quest and receive the{" "}
                <span className="font-semibold text-[var(--foreground)]">{quest.rewardCc} CC</span> reward.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/* ── individual task row ── */

function TaskRow({
  index,
  questId,
  task,
  submission,
  onVerified,
  onQuestComplete,
}: {
  index: number;
  questId: string;
  task: QuestTask;
  submission: QuestSubmission | null;
  onVerified: (sub: QuestSubmission) => void;
  onQuestComplete: (rewardCc: number) => void;
}) {
  const [proof, setProof] = useState(submission?.proof ?? "");
  const [quizAnswer, setQuizAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isVerified = submission?.status === "VERIFIED";
  const isPending = submission?.status === "PENDING";

  async function handleSubmit(proofValue?: string) {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const body = { proof: proofValue ?? proof ?? undefined };
      const res = await fetch(
        `/api/quests/${questId}/tasks/${task.id}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json()) as {
        ok: boolean;
        status?: string;
        message?: string;
        rewardInfo?: { justCompleted: boolean; rewardCc: number };
      };

      if (!res.ok || !data.ok) {
        setError(data.message ?? "Submission failed");
        return;
      }

      const fakeSub: QuestSubmission = {
        id: "local",
        taskId: task.id,
        status: (data.status ?? "VERIFIED") as "PENDING" | "VERIFIED" | "REJECTED",
        proof: proofValue ?? proof ?? null,
        submittedAt: new Date().toISOString(),
      };
      onVerified(fakeSub);

      if (data.status === "VERIFIED") {
        setSuccessMsg("Task verified ✓");
      } else {
        setSuccessMsg("Submitted — pending review");
      }

      if (data.rewardInfo?.justCompleted) {
        onQuestComplete(data.rewardInfo.rewardCc);
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  const taskLabel = TASK_LABELS[task.type as QuestTaskType] ?? task.type;

  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 transition-colors",
        isVerified && "border-[var(--primary)]/40 bg-[var(--primary)]/5",
        isPending && "border-amber-500/30 bg-amber-500/5",
      )}
    >
      <div className="flex gap-4">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
            isVerified && "bg-[var(--primary)]/16 ring-1 ring-[var(--primary)]/35",
            !isVerified && "bg-[var(--muted)]",
          )}
        >
          {isVerified ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--foreground)]" />
          ) : (
            <TaskIcon type={task.type} />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Task {index}
            </span>
            <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {taskLabel}
            </span>
            {isVerified && (
              <span className="rounded-md bg-[var(--primary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--primary-foreground)] shadow-sm ring-1 ring-black/10 dark:ring-white/15">
                Verified
              </span>
            )}
            {isPending && (
              <span className="rounded-md bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-950 shadow-md ring-1 ring-amber-200">
                Pending
              </span>
            )}
            <span className="ml-auto rounded-lg bg-[var(--primary)]/18 px-2 py-1 text-xs font-bold tabular-nums text-[var(--foreground)] ring-1 ring-[var(--primary)]/25">
              +{task.points} pts
            </span>
          </div>

          <h3 className="font-[family-name:var(--font-space)] font-semibold leading-snug">
            {task.title}
          </h3>

          {task.description && (
            <p className="text-sm text-[var(--muted-foreground)]">{task.description}</p>
          )}

          {task.target && (
            <p className="font-mono text-xs text-[var(--foreground)]">
              Target:{" "}
              {task.target.startsWith("http") ? (
                <Link
                  href={task.target}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
                >
                  {task.target}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              ) : (
                task.target
              )}
            </p>
          )}

          {/* Input fields for proof-required tasks */}
          {!isVerified && (task.type === "submit_email" || task.type === "submit_canton_address") && (
            <div className="pt-2">
              <label className="sr-only">
                {task.type === "submit_email" ? "Your email" : "Your Party ID"}
              </label>
              <input
                type={task.type === "submit_email" ? "email" : "text"}
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                placeholder={
                  task.type === "submit_email"
                    ? "your@email.com"
                    : "yourname::1220..."
                }
                disabled={loading}
                className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--muted)]/50 px-3 py-2 font-mono text-sm outline-none ring-[var(--ring)] focus-visible:ring-2 disabled:opacity-60"
              />
            </div>
          )}

          {/* Quiz task */}
          {task.type === "quiz_choice" && !isVerified && (
            <div className="space-y-2 pt-2">
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/40 p-3 text-sm">
                <p className="font-medium">Select the correct answer:</p>
                <div className="mt-2 space-y-2">
                  {["a", "b", "c"].map((opt) => (
                    <label key={opt} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name={`quiz-${task.id}`}
                        value={opt}
                        checked={quizAnswer === opt}
                        onChange={() => setQuizAnswer(opt)}
                        disabled={loading}
                        className="accent-[var(--foreground)]"
                      />
                      {opt === "a" && "Canton is a single-machine SQLite database."}
                      {opt === "b" && "Canton validators run distributed ledger consensus."}
                      {opt === "c" && "Canton nodes are only used for file storage."}
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="button"
                disabled={loading || !quizAnswer}
                onClick={() => void handleSubmit(quizAnswer)}
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit answer"}
              </button>
            </div>
          )}

          {/* Social / visit / other tasks — simple mark done button */}
          {task.type !== "quiz_choice" && !isVerified && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                type="button"
                disabled={loading || (["submit_email", "submit_canton_address"].includes(task.type) && !proof.trim())}
                onClick={() => void handleSubmit()}
                className={cn(buttonVariants({ size: "sm" }), "gap-2")}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Circle className="h-4 w-4" />
                    {task.type === "submit_email" || task.type === "submit_canton_address"
                      ? "Submit"
                      : "Mark done"}
                  </>
                )}
              </button>
              {task.type === "visit_website" && task.target && (
                <Link
                  href={task.target}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-1")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Visit
                </Link>
              )}
            </div>
          )}

          {/* SendHorizontal icon for social tasks that show a link */}
          {task.type === "twitter_follow" && task.target && !isVerified && (
            <Link
              href={`https://twitter.com/${task.target.replace("@", "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] underline-offset-4 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open {task.target}
            </Link>
          )}

          {/* Status messages */}
          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {successMsg && !error && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--foreground)]">
              <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--primary)]" aria-hidden />
              {successMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
