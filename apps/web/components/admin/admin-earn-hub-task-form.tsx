"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import {
  earnHubTaskTypeLabel,
  EARN_HUB_TASK_TYPE_OPTIONS,
  getSendTransactionRequiredCount,
  isEarnHubQuizType,
  isSendTransactionTask,
  sendTransactionTitle,
} from "@/lib/quest/quest-types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";


export type EarnHubTaskDraft = {
  type: string;
  points: number;
  title: string;
  target: string;
  correctAnswer: string;
  choiceA: string;
  choiceB: string;
  choiceC: string;
  choiceD: string;
  showNewBadge: boolean;
};

const inputCls =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm outline-none ring-[var(--ring)] focus-visible:ring-2";

export function AdminEarnHubTaskForm({
  draft,
  setDraft,
  onSubmit,
  saving,
  formError,
  submitLabel,
  onCancel,
  idPrefix = "task",
}: {
  draft: EarnHubTaskDraft;
  setDraft: React.Dispatch<React.SetStateAction<EarnHubTaskDraft>>;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
  formError: string | null;
  submitLabel: string;
  onCancel?: () => void;
  idPrefix?: string;
}) {
  const selectedMeta = EARN_HUB_TASK_TYPE_OPTIONS.find((o) => o.value === draft.type);
  const isQuiz = isEarnHubQuizType(draft.type);
  const isQuizChoice = draft.type === "quiz_choice";
  const isQuizYesNo = draft.type === "quiz_yes_no";
  const isSendTx = isSendTransactionTask(draft.type);
  const needsUrl =
    draft.type === "twitter_follow" ||
    draft.type === "twitter_retweet" ||
    draft.type === "telegram_channel" ||
    draft.type === "telegram_group" ||
    draft.type === "discord_join";

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor={`${idPrefix}-type`}>
          Task type
        </label>
        <select
          id={`${idPrefix}-type`}
          value={draft.type}
          onChange={(e) => {
            const nextType = e.target.value;
            setDraft((p) => ({
              ...p,
              type: nextType,
              correctAnswer: nextType === "quiz_choice" ? "A" : "yes",
              // Default required count when switching to send-transaction.
              target: nextType === "send_transaction" && !p.target.trim() ? "1" : p.target,
            }));
          }}
          className={inputCls}
        >
          {EARN_HUB_TASK_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {selectedMeta?.hint ? (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{selectedMeta.hint}</p>
        ) : null}
      </div>

      {!isQuiz ? (
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor={`${idPrefix}-title`}>
            Title shown on Quest{draft.type === "daily_check_in" ? " *" : isSendTx ? "" : " *"}
          </label>
          <input
            id={`${idPrefix}-title`}
            required={draft.type === "daily_check_in"}
            value={draft.title}
            onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
            placeholder={
              draft.type === "daily_check_in"
                ? "e.g. Daily check-in"
                : isSendTx
                  ? sendTransactionTitle(getSendTransactionRequiredCount(draft.target))
                  : needsUrl
                    ? "e.g. Follow @canquest or Retweet our post"
                    : "Task title"
            }
            className={inputCls}
          />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {isSendTx
              ? "Optional — defaults to “Send N transaction(s)” based on the required count."
              : "This is the only line users see — pick any label you want."}
          </p>
        </div>
      ) : null}

      <div>
        <label className="mb-1.5 block text-sm font-medium" htmlFor={`${idPrefix}-points`}>
          Points (if correct)
        </label>
        <input
          id={`${idPrefix}-points`}
          type="number"
          min={0}
          value={draft.points}
          onChange={(e) => setDraft((p) => ({ ...p, points: Number(e.target.value) }))}
          className={inputCls}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2.5">
        <input
          type="checkbox"
          checked={draft.showNewBadge}
          onChange={(e) => setDraft((p) => ({ ...p, showNewBadge: e.target.checked }))}
          className="h-4 w-4 rounded border-[var(--border)]"
        />
        <span className="text-sm text-[var(--foreground)]">
          Show <strong className="text-canton">NEW</strong> label (quiz: points only within 24h;
          label hides after completion or 24h)
        </span>
      </label>

      {isSendTx ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Required sends
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {[1, 3, 5].map((n) => {
                const active =
                  getSendTransactionRequiredCount(draft.target) === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, target: String(n) }))}
                    className={cn(
                      "rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors",
                      active
                        ? "border-canton bg-canton/15 text-canton"
                        : "border-[var(--border)] bg-[var(--muted)]/30 text-[var(--muted-foreground)] hover:border-[var(--foreground)]/40",
                    )}
                  >
                    {n}×
                  </button>
                );
              })}
              <input
                type="number"
                min={1}
                step={1}
                value={draft.target || ""}
                onChange={(e) => setDraft((p) => ({ ...p, target: e.target.value }))}
                placeholder="Custom"
                className={cn(inputCls, "max-w-[7rem] py-1.5")}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Task title:{" "}
              <strong>{sendTransactionTitle(getSendTransactionRequiredCount(draft.target))}</strong>
            </p>
          </div>
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-[var(--muted-foreground)]">
            <strong className="text-amber-400">Send transaction</strong> requires a Canton wallet and
            resets every <strong className="text-canton">24 hours</strong>. Only real outgoing CC sends
            count (platform fees excluded).
          </p>
        </div>
      ) : null}

      {draft.type === "daily_check_in" ? (
        <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-[var(--muted-foreground)]">
          <strong className="text-emerald-400">Daily check-in</strong> stays on Quest permanently.
          Users can check in again every <strong className="text-canton">24 hours</strong> for more
          points.
        </p>
      ) : !isSendTx ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Other tasks stay visible on Quest after completion (one-time — no extra settings needed).
        </p>
      ) : null}

      {needsUrl ? (
        <div>
          <label className="mb-1.5 block text-sm font-medium" htmlFor={`${idPrefix}-target`}>
            Link / URL *
          </label>
          <input
            id={`${idPrefix}-target`}
            required
            value={draft.target}
            onChange={(e) => setDraft((p) => ({ ...p, target: e.target.value }))}
            placeholder="https://…"
            className={inputCls}
          />
        </div>
      ) : null}

      {isQuiz ? (
        <p className="rounded-xl border border-canton/25 bg-canton/10 px-3 py-2 text-xs text-[var(--muted-foreground)]">
          Quizzes are open for <strong className="text-canton">24 hours</strong> after publish.
          Editing does not reset the timer for users who already completed.
        </p>
      ) : null}

      {isQuizYesNo ? (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Title / question *</label>
            <textarea
              required
              rows={2}
              value={draft.title}
              onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Is CanQuest built on Canton Network?"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Shown as the task title on the Quest page.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Correct answer</label>
            <select
              value={draft.correctAnswer}
              onChange={(e) => setDraft((p) => ({ ...p, correctAnswer: e.target.value }))}
              className={inputCls}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </>
      ) : null}

      {isQuizChoice ? (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Title / question *</label>
            <textarea
              required
              rows={2}
              value={draft.title}
              onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Shown as the task title on the Quest page.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["A", "B", "C", "D"] as const).map((letter, idx) => {
              const key = ["choiceA", "choiceB", "choiceC", "choiceD"][idx] as keyof EarnHubTaskDraft;
              return (
                <div key={letter}>
                  <label className="mb-1.5 block text-xs font-medium">
                    Option {letter}
                    {idx < 2 ? " *" : ""}
                  </label>
                  <input
                    value={draft[key] as string}
                    onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              );
            })}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Correct option</label>
            <select
              value={draft.correctAnswer}
              onChange={(e) => setDraft((p) => ({ ...p, correctAnswer: e.target.value }))}
              className={inputCls}
            >
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>
          </div>
        </>
      ) : null}

      {formError ? <p className="text-sm text-red-500">{formError}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className={cn(buttonVariants(), "gap-2 disabled:opacity-50")}
        >
          {saving ? <LoadingSpinner size="md" /> : null}
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className={buttonVariants({ variant: "secondary" })}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
