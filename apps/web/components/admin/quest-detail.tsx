"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Edit,
  Loader2,
  Plus,
  Trash2,
  Users,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { QuestForm } from "./quest-form";

const TASK_TYPES = [
  { value: "twitter_follow", label: "Twitter follow" },
  { value: "twitter_retweet", label: "Twitter retweet" },
  { value: "telegram_join", label: "Telegram join" },
  { value: "discord_join", label: "Discord join" },
  { value: "submit_email", label: "Submit email" },
  { value: "submit_canton_address", label: "Canton Party ID" },
  { value: "visit_website", label: "Visit website" },
  { value: "quiz_choice", label: "Quiz" },
];

interface Task {
  id: string;
  type: string;
  title: string;
  description: string | null;
  points: number;
  target: string | null;
  order: number;
  correctAnswer: string | null;
}

interface QuestData {
  id: string;
  title: string;
  org: string;
  orgSlug: string;
  description: string;
  banner: string;
  bannerImageUrl?: string | null;
  logoUrl?: string | null;
  rewardCc: number;
  rewardPool: string;
  deadline: string | null;
  status: string;
  rewardType: string;
  maxWinners: number | null;
  tags: string[];
  tasks: Task[];
  _count: { completions: number; winnerDraws: number };
}

export function QuestDetail({ questId }: { questId: string }) {
  const router = useRouter();
  const [quest, setQuest] = useState<QuestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"overview" | "edit" | "tasks">("overview");
  const [addingTask, setAddingTask] = useState(false);
  const [newTask, setNewTask] = useState({
    type: "visit_website",
    title: "",
    description: "",
    points: 10,
    target: "",
    correctAnswer: "",
  });
  const [taskSaving, setTaskSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/quests/${questId}`)
      .then((r) => r.json())
      .then((d: QuestData) => setQuest(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [questId]);

  async function handleDeleteQuest() {
    if (!confirm("Delete this quest and all its data? This cannot be undone.")) return;
    setDeleting(true);
    await fetch(`/api/admin/quests/${questId}`, { method: "DELETE" });
    router.push("/admin");
  }

  async function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    setTaskSaving(true);
    const res = await fetch(`/api/admin/quests/${questId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: newTask.type,
        title: newTask.title,
        description: newTask.description || null,
        points: newTask.points,
        target: newTask.target || null,
        correctAnswer: newTask.correctAnswer || null,
      }),
    });
    if (res.ok) {
      const task = (await res.json()) as Task;
      setQuest((prev) => prev ? { ...prev, tasks: [...prev.tasks, task] } : prev);
      setAddingTask(false);
      setNewTask({ type: "visit_website", title: "", description: "", points: 10, target: "", correctAnswer: "" });
    }
    setTaskSaving(false);
  }

  async function handleDeleteTask(taskId: string) {
    if (!confirm("Delete this task?")) return;
    await fetch(`/api/admin/tasks/${taskId}`, { method: "DELETE" });
    setQuest((prev) =>
      prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== taskId) } : prev,
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (!quest) {
    return <p className="text-[var(--muted-foreground)]">Quest not found.</p>;
  }

  const inputCls =
    "w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm outline-none ring-[var(--ring)] focus-visible:ring-2";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/admin"
            className="mt-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-[family-name:var(--font-space)] text-xl font-semibold">
              {quest.title}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{quest.org}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleDeleteQuest()}
          disabled={deleting}
          className="flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Delete
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Completions", value: quest._count.completions, icon: Users },
          { label: "Winners drawn", value: quest._count.winnerDraws, icon: Trophy },
          { label: "CC reward", value: `${quest.rewardCc} CC`, icon: null },
          { label: "Max winners", value: quest.maxWinners ?? "∞", icon: null },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">{s.label}</p>
            <p className="mt-1 font-[family-name:var(--font-space)] text-xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div className="flex gap-2 border-b border-[var(--border)]">
        {(["overview", "tasks", "edit"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setView(tab)}
            className={cn(
              "pb-2.5 text-sm font-semibold capitalize transition-colors",
              view === tab
                ? "border-b-2 border-[var(--foreground)] text-[var(--foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {tab}
          </button>
        ))}
        <Link
          href={`/admin/quests/${questId}/winners`}
          className="ml-auto pb-2.5 text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          Winners →
        </Link>
      </div>

      {/* Overview */}
      {view === "overview" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{quest.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {quest.tags.map((t) => (
                <span key={t} className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-xs font-semibold">{t}</span>
              ))}
            </div>
            <div
              className="mt-4 h-36 rounded-xl bg-cover bg-center"
              style={
                quest.bannerImageUrl
                  ? { backgroundImage: `url("${quest.bannerImageUrl}")` }
                  : { background: quest.banner }
              }
            />
            <div className="mt-3 flex items-center gap-3">
              {quest.logoUrl ? (
                <img src={quest.logoUrl} alt="" className="h-12 w-12 rounded-xl border border-[var(--border)] object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--muted)] text-sm font-bold">
                  {quest.orgSlug.slice(0, 2)}
                </div>
              )}
              <p className="text-xs text-[var(--muted-foreground)]">Logo shown on participant quest cards.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">Reward pool label</p>
              <p className="mt-1 font-semibold">{quest.rewardPool}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">Reward type</p>
              <p className="mt-1 font-semibold">{quest.rewardType}</p>
            </div>
          </div>
        </div>
      )}

      {/* Edit */}
      {view === "edit" && (
        <QuestForm initialData={quest} />
      )}

      {/* Tasks */}
      {view === "tasks" && (
        <div className="space-y-3">
          {quest.tasks.length === 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">No tasks yet.</p>
          )}
          {quest.tasks.map((task, idx) => (
            <div
              key={task.id}
              className="flex items-start gap-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--muted)] text-xs font-bold">
                {idx + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold uppercase">
                    {TASK_TYPES.find((t) => t.value === task.type)?.label ?? task.type}
                  </span>
                  <span className="text-sm font-semibold">{task.title}</span>
                  <span className="ml-auto text-xs text-[var(--muted-foreground)]">+{task.points} pts</span>
                </div>
                {task.description && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{task.description}</p>}
                {task.target && <p className="mt-1 font-mono text-xs">Target: {task.target}</p>}
                {task.correctAnswer && <p className="mt-1 text-xs text-[var(--muted-foreground)]">Answer: {task.correctAnswer}</p>}
              </div>
              <button
                type="button"
                onClick={() => void handleDeleteTask(task.id)}
                className="shrink-0 text-red-400 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          {/* Add task form */}
          {addingTask ? (
            <form onSubmit={(e) => void handleAddTask(e)} className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-3">
              <p className="font-semibold">New task</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">Type</label>
                  <select value={newTask.type} onChange={(e) => setNewTask((p) => ({ ...p, type: e.target.value }))} className={inputCls}>
                    {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Points</label>
                  <input type="number" min="1" value={newTask.points} onChange={(e) => setNewTask((p) => ({ ...p, points: Number(e.target.value) }))} className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium">Title *</label>
                  <input required value={newTask.title} onChange={(e) => setNewTask((p) => ({ ...p, title: e.target.value }))} placeholder="Task title" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium">Description</label>
                  <input value={newTask.description} onChange={(e) => setNewTask((p) => ({ ...p, description: e.target.value }))} placeholder="Optional" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Target / URL</label>
                  <input value={newTask.target} onChange={(e) => setNewTask((p) => ({ ...p, target: e.target.value }))} placeholder="@handle or https://..." className={inputCls} />
                </div>
                {newTask.type === "quiz_choice" && (
                  <div>
                    <label className="mb-1 block text-xs font-medium">Correct answer (a/b/c)</label>
                    <input value={newTask.correctAnswer} onChange={(e) => setNewTask((p) => ({ ...p, correctAnswer: e.target.value }))} placeholder="b" className={inputCls} />
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={taskSaving} className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-60">
                  {taskSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save task
                </button>
                <button type="button" onClick={() => setAddingTask(false)} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--muted)]">Cancel</button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingTask(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] py-4 text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
            >
              <Plus className="h-4 w-4" /> Add task
            </button>
          )}
        </div>
      )}
    </div>
  );
}
