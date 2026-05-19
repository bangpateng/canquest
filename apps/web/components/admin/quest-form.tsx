"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Loader2, Plus, Trash2, ChevronDown, ChevronUp, Upload } from "lucide-react";

type TaskDraft = {
  type: string;
  title: string;
  description: string;
  points: number;
  target: string;
  correctAnswer: string;
};

const TASK_TYPES = [
  { value: "twitter_follow", label: "Twitter follow" },
  { value: "twitter_retweet", label: "Twitter retweet" },
  { value: "telegram_join", label: "Telegram join" },
  { value: "discord_join", label: "Discord join" },
  { value: "submit_email", label: "Submit email" },
  { value: "submit_canton_address", label: "Submit Canton Party ID" },
  { value: "visit_website", label: "Visit website" },
  { value: "quiz_choice", label: "Quiz (single choice)" },
];

const REWARD_TYPES = [
  { value: "CC_ONLY", label: "CC Only" },
  { value: "INVITE_CODE", label: "Invite Code Only" },
  { value: "CC_AND_INVITE", label: "CC + Invite Code" },
];

const QUEST_STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "COMING_SOON", label: "Coming Soon" },
  { value: "ENDED", label: "Ended" },
];

const BANNER_PRESETS = [
  {
    label: "Canton Blue",
    value:
      "linear-gradient(135deg,rgba(6,182,212,0.42) 0%,rgba(6,182,212,0.18) 40%,rgba(17,24,39,0.40) 100%)",
  },
  {
    label: "Violet",
    value: "linear-gradient(135deg,rgba(99,102,241,0.35) 0%,rgba(30,58,138,0.45) 100%)",
  },
  {
    label: "Rose",
    value:
      "linear-gradient(135deg,rgba(244,114,182,0.30) 0%,rgba(88,28,135,0.40) 100%)",
  },
  {
    label: "Emerald",
    value:
      "linear-gradient(135deg,rgba(16,185,129,0.35) 0%,rgba(5,78,56,0.45) 100%)",
  },
  {
    label: "Midnight",
    value: "linear-gradient(135deg,#1e293b,#0f172a)",
  },
];

interface QuestFormProps {
  initialData?: {
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
  };
}

export function QuestForm({ initialData }: QuestFormProps) {
  const router = useRouter();
  const isEdit = !!initialData?.id;

  const [form, setForm] = useState({
    title: initialData?.title ?? "",
    org: initialData?.org ?? "",
    orgSlug: initialData?.orgSlug ?? "",
    description: initialData?.description ?? "",
    banner: initialData?.banner ?? BANNER_PRESETS[0]!.value,
    bannerImageUrl: initialData?.bannerImageUrl ?? "",
    logoUrl: initialData?.logoUrl ?? "",
    rewardCc: String(initialData?.rewardCc ?? "0"),
    rewardPool: initialData?.rewardPool ?? "",
    deadline: initialData?.deadline ?? "",
    status: initialData?.status ?? "ACTIVE",
    rewardType: initialData?.rewardType ?? "CC_ONLY",
    maxWinners: String(initialData?.maxWinners ?? ""),
    tags: (initialData?.tags ?? []).join(", "),
  });

  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTasks, setShowTasks] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  async function uploadQuestAsset(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/uploads/quest-asset", { method: "POST", body: fd });
    const data = (await res.json()) as { url?: string; message?: string };
    if (!res.ok) throw new Error(data.message ?? "Upload failed");
    if (!data.url) throw new Error("No URL returned");
    return data.url;
  }

  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateRewardType(value: string) {
    setForm((prev) => ({
      ...prev,
      rewardType: value,
      rewardCc: value === "INVITE_CODE" ? "0" : prev.rewardCc,
    }));
  }

  const showCcField = form.rewardType === "CC_ONLY" || form.rewardType === "CC_AND_INVITE";

  function addTask() {
    setTasks((prev) => [
      ...prev,
      { type: "visit_website", title: "", description: "", points: 10, target: "", correctAnswer: "" },
    ]);
    setShowTasks(true);
  }

  function updateTask(idx: number, key: keyof TaskDraft, value: string | number) {
    setTasks((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, [key]: value } : t)),
    );
  }

  function removeTask(idx: number) {
    setTasks((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const rt = form.rewardType;
      const cc = Number(form.rewardCc) || 0;
      const maxW = form.maxWinners.trim() === "" ? null : Number(form.maxWinners);

      if (rt === "INVITE_CODE") {
        if (maxW === null || !Number.isFinite(maxW) || maxW < 1) {
          setError("Invite Code Only: fill in Winner count (at least 1).");
          setSubmitting(false);
          return;
        }
      }

      if (rt === "CC_ONLY" || rt === "CC_AND_INVITE") {
        if (cc <= 0) {
          setError(
            rt === "CC_AND_INVITE"
              ? "CC + Invite Code: CC per winner must be greater than 0."
              : "CC Only: CC per winner must be greater than 0.",
          );
          setSubmitting(false);
          return;
        }
        if (maxW === null || !Number.isFinite(maxW) || maxW < 1) {
          setError(`${rt === "CC_AND_INVITE" ? "CC + Invite Code" : "CC Only"}: fill in Winner count (at least 1).`);
          setSubmitting(false);
          return;
        }
      }

      const rewardCcPayload = rt === "INVITE_CODE" ? 0 : cc;

      const payload = {
        title: form.title,
        org: form.org,
        orgSlug: form.orgSlug || form.org.slice(0, 3).toUpperCase(),
        description: form.description,
        banner: form.banner,
        bannerImageUrl: form.bannerImageUrl.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        rewardCc: rewardCcPayload,
        rewardPool:
          form.rewardPool ||
          (rewardCcPayload > 0 ? `${rewardCcPayload} CC` : rt === "INVITE_CODE" ? "Invite codes only" : "TBD"),
        deadline: form.deadline || null,
        status: form.status,
        rewardType: form.rewardType,
        maxWinners: maxW,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        ...(tasks.length > 0 && {
          tasks: tasks.map((t, i) => ({
            type: t.type,
            title: t.title,
            description: t.description || null,
            points: t.points,
            target: t.target || null,
            order: i,
            correctAnswer: t.correctAnswer || null,
          })),
        }),
      };

      const url = isEdit
        ? `/api/admin/quests/${initialData!.id}`
        : `/api/admin/quests`;
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { id?: string; message?: string };

      if (!res.ok) {
        setError((data.message as string | undefined) ?? "Failed to save quest");
        return;
      }

      router.push(isEdit ? `/admin/quests/${initialData!.id}` : `/admin/quests/${data.id!}`);
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2.5 text-sm outline-none ring-[var(--ring)] transition-shadow focus-visible:ring-2";

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
      {/* Basic Info */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <h2 className="font-[family-name:var(--font-space)] font-semibold">Basic Info</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Quest title *</label>
            <input required value={form.title} onChange={(e) => updateField("title", e.target.value)} placeholder="e.g. Canton Builder Season Wave 3" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Organization *</label>
            <input required value={form.org} onChange={(e) => updateField("org", e.target.value)} placeholder="e.g. Digital Asset Collective" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Org slug (2–4 chars)</label>
            <input value={form.orgSlug} onChange={(e) => updateField("orgSlug", e.target.value.toUpperCase())} placeholder="DA" maxLength={4} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Deadline (display)</label>
            <input value={form.deadline} onChange={(e) => updateField("deadline", e.target.value)} placeholder="e.g. Jun 30, 2026" className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium">Project logo</label>
            <p className="mb-2 text-xs text-[var(--muted-foreground)]">
              Square image (JPEG, PNG, WebP, GIF, max 4 MB). Shown on quest cards next to the title. Leave empty to use org initials.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="" className="h-14 w-14 rounded-xl border border-[var(--border)] object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/40 text-xs font-semibold text-[var(--muted-foreground)]">
                  {form.orgSlug.slice(0, 2) || "—"}
                </div>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--muted)]">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  disabled={uploadingLogo}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    setUploadMsg(null);
                    setUploadingLogo(true);
                    void uploadQuestAsset(f)
                      .then((url) => updateField("logoUrl", url))
                      .catch((err: unknown) =>
                        setUploadMsg(err instanceof Error ? err.message : "Logo upload failed"),
                      )
                      .finally(() => setUploadingLogo(false));
                  }}
                />
                {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload logo
              </label>
              {form.logoUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    updateField("logoUrl", "");
                    setUploadMsg(null);
                  }}
                  className="text-sm font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Remove logo
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Description *</label>
          <textarea required rows={3} value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Describe the quest goals and tasks..." className={cn(inputCls, "resize-none")} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Tags (comma-separated)</label>
          <input value={form.tags} onChange={(e) => updateField("tags", e.target.value)} placeholder="Live, Featured, Learning" className={inputCls} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Status</label>
          <select value={form.status} onChange={(e) => updateField("status", e.target.value)} className={inputCls}>
            {QUEST_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </section>

      {/* Banner */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <h2 className="font-[family-name:var(--font-space)] font-semibold">Banner</h2>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Event banner image</label>
          <p className="mb-2 text-xs text-[var(--muted-foreground)]">
            Wide image across the top of the quest card (JPEG, PNG, WebP, GIF, max 4 MB). When set, this replaces the gradient for the hero area.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--muted)]">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                disabled={uploadingBanner}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setUploadMsg(null);
                  setUploadingBanner(true);
                  void uploadQuestAsset(f)
                    .then((url) => updateField("bannerImageUrl", url))
                    .catch((err: unknown) =>
                      setUploadMsg(err instanceof Error ? err.message : "Banner upload failed"),
                    )
                    .finally(() => setUploadingBanner(false));
                }}
              />
              {uploadingBanner ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload banner
            </label>
            {form.bannerImageUrl ? (
              <button
                type="button"
                onClick={() => {
                  updateField("bannerImageUrl", "");
                  setUploadMsg(null);
                }}
                className="text-sm font-medium text-red-600 hover:underline dark:text-red-400"
              >
                Remove banner image
              </button>
            ) : null}
          </div>
        </div>

        <div
          className="h-28 rounded-xl border border-[var(--border)] bg-cover bg-center"
          style={
            form.bannerImageUrl
              ? { backgroundImage: `url("${form.bannerImageUrl}")` }
              : { background: form.banner }
          }
        />

        <p className="text-xs font-medium text-[var(--muted-foreground)]">Fallback gradient (when no banner image)</p>
        <div className="flex flex-wrap gap-2">
          {BANNER_PRESETS.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => updateField("banner", b.value)}
              className={cn(
                "h-10 w-28 rounded-xl border-2 transition-all",
                form.banner === b.value ? "border-[var(--primary)]" : "border-transparent",
              )}
              style={{ background: b.value }}
              title={b.label}
            />
          ))}
        </div>
        <input value={form.banner} onChange={(e) => updateField("banner", e.target.value)} placeholder="Custom CSS gradient…" className={inputCls} />
      </section>

      {/* Reward */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <h2 className="font-[family-name:var(--font-space)] font-semibold">Reward</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Reward type</label>
            <select value={form.rewardType} onChange={(e) => updateRewardType(e.target.value)} className={inputCls}>
              {REWARD_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              {form.rewardType === "INVITE_CODE" && "Invite Code Only — set winner count below. CC is not used."}
              {form.rewardType === "CC_ONLY" && "CC Only — fill CC per winner and winner count."}
              {form.rewardType === "CC_AND_INVITE" && "CC + Invite Code — fill CC per winner and winner count (invites handled when distributing)."}
            </p>
          </div>
          <div className={cn("grid gap-4", showCcField ? "sm:grid-cols-2" : "sm:grid-cols-1 sm:max-w-xs")}>
            {showCcField && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">CC per winner</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required={showCcField}
                  value={form.rewardCc}
                  onChange={(e) => updateField("rewardCc", e.target.value)}
                  placeholder="e.g. 100"
                  className={inputCls}
                />
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Max winners</label>
              <input
                type="number"
                min="1"
                step="1"
                required
                value={form.maxWinners}
                onChange={(e) => updateField("maxWinners", e.target.value)}
                placeholder="e.g. 10"
                className={inputCls}
              />
            </div>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Reward pool label (shown to users)</label>
          <input
            value={form.rewardPool}
            onChange={(e) => updateField("rewardPool", e.target.value)}
            placeholder={
              showCcField
                ? `e.g. ${form.rewardCc || "…"} CC · WL spots`
                : "e.g. WL spots · invite codes"
            }
            className={inputCls}
          />
        </div>
      </section>

      {/* Tasks (optional at creation) */}
      {!isEdit && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
          <button
            type="button"
            onClick={() => setShowTasks((v) => !v)}
            className="flex w-full items-center justify-between font-[family-name:var(--font-space)] font-semibold"
          >
            <span>Tasks ({tasks.length})</span>
            {showTasks ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <p className="text-xs text-[var(--muted-foreground)]">
            You can add tasks now or after quest creation.
          </p>

          {showTasks && (
            <div className="space-y-3">
              {tasks.map((task, idx) => (
                <div key={idx} className="rounded-xl border border-[var(--border)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">Task {idx + 1}</span>
                    <button type="button" onClick={() => removeTask(idx)} className="text-red-500 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium">Type</label>
                      <select value={task.type} onChange={(e) => updateTask(idx, "type", e.target.value)} className={cn(inputCls, "py-2")}>
                        {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Points</label>
                      <input type="number" min="1" value={task.points} onChange={(e) => updateTask(idx, "points", Number(e.target.value))} className={cn(inputCls, "py-2")} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium">Title *</label>
                      <input required value={task.title} onChange={(e) => updateTask(idx, "title", e.target.value)} placeholder="Task title" className={cn(inputCls, "py-2")} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium">Description</label>
                      <input value={task.description} onChange={(e) => updateTask(idx, "description", e.target.value)} placeholder="Optional instructions" className={cn(inputCls, "py-2")} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Target / URL / Handle</label>
                      <input value={task.target} onChange={(e) => updateTask(idx, "target", e.target.value)} placeholder="@handle or https://..." className={cn(inputCls, "py-2")} />
                    </div>
                    {task.type === "quiz_choice" && (
                      <div>
                        <label className="mb-1 block text-xs font-medium">Correct answer (a/b/c)</label>
                        <input value={task.correctAnswer} onChange={(e) => updateTask(idx, "correctAnswer", e.target.value)} placeholder="b" className={cn(inputCls, "py-2")} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addTask}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] py-3 text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
              >
                <Plus className="h-4 w-4" /> Add task
              </button>
            </div>
          )}

          {!showTasks && (
            <button
              type="button"
              onClick={addTask}
              className="flex items-center gap-2 text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline"
            >
              <Plus className="h-4 w-4" /> Add task
            </button>
          )}
        </section>
      )}

      {uploadMsg && (
        <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-900 dark:text-amber-300">
          {uploadMsg}
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isEdit ? "Save Changes" : "Create Quest"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-[var(--border)] px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--muted)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
