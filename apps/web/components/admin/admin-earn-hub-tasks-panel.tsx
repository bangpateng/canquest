"use client";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import {
  AdminEarnHubTaskForm,
  type EarnHubTaskDraft,
} from "@/components/admin/admin-earn-hub-task-form";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  buildEarnHubTaskPayload,
  earnHubTaskToDraft,
  getEarnHubTaskRowDisplay,
  isEarnHubQuizType,
  parseQuizChoices,
  validateEarnHubTaskDraft,
} from "@/lib/quest/quest-types";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";

export interface EarnHubTask {
  id: string;
  type: string;
  title: string;
  description: string | null;
  points: number;
  target: string | null;
  correctAnswer: string | null;
  order: number;
  showNewBadge?: boolean;
  createdAt?: string;
}

export interface EarnHubQuest {
  id: string;
  title: string;
  status: string;
  tasks: EarnHubTask[];
}

const defaultDraft: EarnHubTaskDraft = {
  type: "daily_check_in",
  points: 10,
  title: "",
  target: "",
  correctAnswer: "yes",
  choiceA: "",
  choiceB: "",
  choiceC: "",
  choiceD: "",
  showNewBadge: false,
};

export function AdminEarnHubTasksPanel({
  hub,
  onEnsureHub,
  ensuring,
  ensureError,
}: {
  hub: EarnHubQuest | null;
  onEnsureHub: () => void;
  ensuring: boolean;
  ensureError: string | null;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<EarnHubTask[]>(hub?.tasks ?? []);
  const [draft, setDraft] = useState<EarnHubTaskDraft>(defaultDraft);
  const [editDraft, setEditDraft] = useState<EarnHubTaskDraft | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(true);

  useEffect(() => {
    setTasks(hub?.tasks ?? []);
  }, [hub]);

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.order - b.order),
    [tasks],
  );

  if (!hub) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] p-10 text-center">
        <p className="font-semibold">Start CanQuest Quest tasks</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted-foreground)]">
          One hub for the user <strong>Quest</strong> menu. After setup you only add tasks here —
          no banners, invite codes, or campaign settings.
        </p>
        {ensureError ? <p className="mt-3 text-sm text-red-500">{ensureError}</p> : null}
        <button
          type="button"
          onClick={onEnsureHub}
          disabled={ensuring}
          className={cn(buttonVariants(), "mt-6 gap-2 disabled:opacity-50")}
        >
          {ensuring ? <LoadingSpinner size="md" /> : <Plus className="h-4 w-4" />}
          Set up Quest hub
        </button>
      </div>
    );
  }

  function cancelEdit() {
    setEditingTaskId(null);
    setEditDraft(null);
    setFormError(null);
  }

  function startEdit(task: EarnHubTask) {
    setEditingTaskId(task.id);
    setEditDraft(earnHubTaskToDraft(task));
    setFormError(null);
    setShowForm(false);
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const err = validateEarnHubTaskDraft(draft);
    if (err) {
      setFormError(err);
      return;
    }

    setSaving(true);
    try {
      const payload = buildEarnHubTaskPayload(draft);
      const res = await fetch(`/api/admin/quests/${hub!.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, order: tasks.length }),
      });
      const data = (await res.json()) as EarnHubTask & { message?: string };
      if (!res.ok) {
        setFormError(data.message ?? "Failed to add task");
        return;
      }
      setTasks((prev) => [...prev, data]);
      setDraft({ ...defaultDraft, type: draft.type });
      router.refresh();
    } catch {
      setFormError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTaskId || !editDraft) return;
    setFormError(null);
    const err = validateEarnHubTaskDraft(editDraft);
    if (err) {
      setFormError(err);
      return;
    }

    setSaving(true);
    try {
      const payload = buildEarnHubTaskPayload(editDraft);
      const res = await fetch(`/api/admin/tasks/${editingTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as EarnHubTask & { message?: string };
      if (!res.ok) {
        setFormError(data.message ?? "Failed to update task");
        return;
      }
      setTasks((prev) => prev.map((t) => (t.id === editingTaskId ? { ...t, ...data } : t)));
      cancelEdit();
      router.refresh();
    } catch {
      setFormError("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTask(task: EarnHubTask) {
    if (task.type === "daily_check_in") {
      alert("Daily check-in is permanent and cannot be deleted.");
      return;
    }
    if (!confirm("Delete this task?")) return;
    const taskId = task.id;
    if (editingTaskId === taskId) cancelEdit();
    await fetch(`/api/admin/tasks/${taskId}`, { method: "DELETE" });
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)]/80 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">{hub.title}</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {sortedTasks.length} task(s) · shown on user Quest page
          </p>
        </div>
        <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-400">
          {hub.status}
        </span>
      </div>

      <section className="space-y-3">
        <h2 className="type-section-title">Published tasks</h2>
        {sortedTasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-sm text-[var(--muted-foreground)]">
            No tasks yet — add your first task below.
          </p>
        ) : (
          <ul className="space-y-2">
            {sortedTasks.map((t) => {
              const row = getEarnHubTaskRowDisplay(t);
              const isEditing = editingTaskId === t.id && editDraft;

              if (isEditing) {
                return (
                  <li
                    key={t.id}
                    className="rounded-xl border border-[var(--primary)]/35 bg-[var(--card)] p-4"
                  >
                    <p className="mb-3 text-sm font-semibold text-canton">Edit task</p>
                    <AdminEarnHubTaskForm
                      idPrefix={`edit-${t.id}`}
                      draft={editDraft}
                      setDraft={setEditDraft as React.Dispatch<React.SetStateAction<EarnHubTaskDraft>>}
                      onSubmit={handleUpdateTask}
                      saving={saving}
                      formError={formError}
                      submitLabel="Save changes"
                      onCancel={cancelEdit}
                    />
                  </li>
                );
              }

              return (
                <li
                  key={t.id}
                  className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
                >
                  <GripVertical className="mt-1 h-4 w-4 shrink-0 text-[var(--muted-foreground)] opacity-40" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--foreground)]">{row.headline}</p>
                      {row.showNew ? (
                        <span className="rounded-md bg-canton/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-canton">
                          New
                        </span>
                      ) : null}
                      <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-xs font-bold tabular-nums">
                        +{t.points} pts
                      </span>
                    </div>
                    {t.target && !isEarnHubQuizType(t.type) && row.headline !== t.target ? (
                      <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                        {t.target}
                      </p>
                    ) : null}
                    {t.type === "quiz_choice" ? (
                      <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted-foreground)]">
                        {parseQuizChoices(t.target).map((c, idx) => (
                          <li key={idx}>
                            <span
                              className={cn(
                                "font-bold",
                                String.fromCharCode(65 + idx) === t.correctAnswer?.toUpperCase() &&
                                  "text-canton",
                              )}
                            >
                              {String.fromCharCode(65 + idx)}.
                            </span>{" "}
                            {c}
                            {String.fromCharCode(65 + idx) === t.correctAnswer?.toUpperCase()
                              ? " ✓"
                              : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {t.type === "quiz_yes_no" && t.correctAnswer ? (
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        Correct answer: <strong className="text-canton">{t.correctAnswer}</strong>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className="text-[var(--muted-foreground)] hover:text-canton"
                      aria-label="Edit task"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTask(t)}
                      className="text-red-400 hover:text-red-500"
                      aria-label="Delete task"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
        <button
          type="button"
          onClick={() => {
            setShowForm((v) => !v);
            if (!showForm) cancelEdit();
          }}
          className="flex w-full items-center justify-between text-left"
        >
          <h2 className="type-section-title">Add task</h2>
          <span className="text-xs text-[var(--muted-foreground)]">{showForm ? "Hide" : "Show"}</span>
        </button>

        {showForm && !editingTaskId ? (
          <div className="mt-4">
            <AdminEarnHubTaskForm
              idPrefix="add"
              draft={draft}
              setDraft={setDraft}
              onSubmit={handleAddTask}
              saving={saving}
              formError={formError}
              submitLabel="Add to Quest"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
