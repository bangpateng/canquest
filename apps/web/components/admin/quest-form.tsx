"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Plus, Trash2, ChevronDown, ChevronUp, Upload } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  QUEST_TASK_TYPE_OPTIONS,
  REWARD_TYPE_OPTIONS,
  buildQuestTaskTitle,
  DEFAULT_QUEST_BANNER,
  formatQuestDeadlineDisplay,
  type RewardType,
} from "@/lib/quest-types";

type TaskDraft = {
  type: string;
  points: number;
  target: string;
  correctAnswer: string;
};

const QUEST_STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "COMING_SOON", label: "Coming Soon" },
  { value: "ENDED", label: "Ended" },
];

export type AdminQuestKind = "CAMPAIGN" | "EARN_HUB";

interface QuestFormProps {
  questKind?: AdminQuestKind;
  /** After create, redirect to manage page; list link uses redirectBase */
  redirectBase?: string;
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
    startsAt?: string | null;
    endsAt?: string | null;
  };
}

export function QuestForm({
  initialData,
  questKind = "CAMPAIGN",
}: QuestFormProps) {
  const router = useRouter();
  const isEdit = !!initialData?.id;

  const [form, setForm] = useState({
    title: initialData?.title ?? "",
    org: initialData?.org ?? "",
    orgSlug: initialData?.orgSlug ?? "",
    description: initialData?.description ?? "",
    bannerImageUrl: initialData?.bannerImageUrl ?? "",
    logoUrl: initialData?.logoUrl ?? "",
    rewardCc: String(initialData?.rewardCc ?? "0"),
    rewardPool: initialData?.rewardPool ?? "",
    startsAt: initialData?.startsAt
      ? new Date(initialData.startsAt).toISOString().slice(0, 16)
      : "",
    endsAt: initialData?.endsAt
      ? new Date(initialData.endsAt).toISOString().slice(0, 16)
      : "",
    status: initialData?.status ?? "ACTIVE",
    rewardType: (initialData?.rewardType === "INVITE_CODE"
      ? "INVITE_CODE_RANDOM"
      : initialData?.rewardType ?? "CC_ONLY") as RewardType,
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

  function updateRewardType(value: RewardType) {
    const noCc =
      value === "WAITLIST_EMAIL" ||
      value === "INVITE_CODE_RANDOM" ||
      value === "INVITE_CODE_FCFS";
    setForm((prev) => ({
      ...prev,
      rewardType: value,
      rewardCc: noCc ? "0" : prev.rewardCc,
    }));
  }

  const showCcField =
    form.rewardType === "CC_ONLY" || form.rewardType === "CC_AND_INVITE";
  const needsMaxWinners =
    form.rewardType !== "WAITLIST_EMAIL" && form.rewardType !== "CC_ONLY";

  const recommendedTaskType =
    form.rewardType === "WAITLIST_EMAIL"
      ? "submit_email"
      : form.rewardType === "CC_ONLY" || form.rewardType === "CC_AND_INVITE"
        ? "submit_party_id"
        : null;
  const hasRecommendedTask =
    !recommendedTaskType ||
    tasks.some((t) => t.type === recommendedTaskType);

  function addTask() {
    setTasks((prev) => [
      ...prev,
      { type: "twitter_follow", points: 10, target: "", correctAnswer: "" },
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

      if (
        rt === "INVITE_CODE_RANDOM" ||
        rt === "INVITE_CODE_FCFS" ||
        rt === "CC_AND_INVITE"
      ) {
        if (maxW === null || !Number.isFinite(maxW) || maxW < 1) {
          setError("Set max winners / FCFS slots (at least 1).");
          setSubmitting(false);
          return;
        }
      }

      if (rt === "CC_ONLY" || rt === "CC_AND_INVITE") {
        if (cc <= 0) {
          setError(
            rt === "CC_AND_INVITE"
              ? "CC + Code: CC amount must be greater than 0."
              : "Reward CC: CC amount must be greater than 0.",
          );
          setSubmitting(false);
          return;
        }
      }

      if (form.startsAt && form.endsAt) {
        const start = new Date(form.startsAt).getTime();
        const end = new Date(form.endsAt).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          setError("End date/time must be after start date/time.");
          setSubmitting(false);
          return;
        }
      }

      const rewardCcPayload =
        rt === "WAITLIST_EMAIL" ||
        rt === "INVITE_CODE_RANDOM" ||
        rt === "INVITE_CODE_FCFS"
          ? 0
          : cc;

      const payload = {
        title: form.title,
        org: form.org,
        orgSlug: form.orgSlug || form.org.slice(0, 3).toUpperCase(),
        description: form.description,
        banner: (isEdit && initialData?.banner) || DEFAULT_QUEST_BANNER,
        bannerImageUrl: form.bannerImageUrl.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        rewardCc: rewardCcPayload,
        rewardPool:
          form.rewardPool ||
          (rewardCcPayload > 0 ? `${rewardCcPayload} CC` : rt === "INVITE_CODE" ? "Invite codes only" : "TBD"),
        deadline: form.endsAt
          ? formatQuestDeadlineDisplay(new Date(form.endsAt).toISOString())
          : null,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        status: form.status,
        rewardType: form.rewardType,
        maxWinners: maxW,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        ...(!isEdit && { questKind }),
        ...(tasks.length > 0 && {
          tasks: tasks.map((t, i) => ({
            type: t.type,
            title: buildQuestTaskTitle(t.type, t.target),
            description: null,
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

      let data: { id?: string; message?: string } = {};
      try {
        const text = await res.text();
        data = text ? (JSON.parse(text) as typeof data) : {};
      } catch {
        data = {};
      }

      if (!res.ok) {
        setError(data.message ?? `Server error (${res.status})`);
        return;
      }

      router.push(`/admin/quests/${isEdit ? initialData!.id : data.id!}`);
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
        <h2 className="type-section-title">Basic Info</h2>

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
            <label className="mb-1.5 block text-sm font-medium">Starts at (timeline)</label>
            <input type="datetime-local" value={form.startsAt} onChange={(e) => updateField("startsAt", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Ends at (timeline)</label>
            <input type="datetime-local" value={form.endsAt} onChange={(e) => updateField("endsAt", e.target.value)} className={inputCls} />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Shown on quest cards as the deadline (no separate display field).
            </p>
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
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-4 py-2 text-sm font-semibold transition-colors hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10">
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
                {uploadingLogo ? <LoadingSpinner size="md" /> : <Upload className="h-4 w-4" />}
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
        <h2 className="type-section-title">Banner</h2>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Event banner image</label>
          <p className="mb-2 text-xs text-[var(--muted-foreground)]">
            Wide image on the quest card (JPEG, PNG, WebP, GIF, max 4 MB). Optional — cards use a default style without an image.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-4 py-2 text-sm font-semibold transition-colors hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10">
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
              {uploadingBanner ? <LoadingSpinner size="md" /> : <Upload className="h-4 w-4" />}
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

        {form.bannerImageUrl ? (
          <div
            className="h-28 rounded-xl border border-[var(--border)] bg-cover bg-center"
            style={{ backgroundImage: `url("${form.bannerImageUrl}")` }}
          />
        ) : null}
      </section>

      {/* Reward */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <h2 className="type-section-title">Reward</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Reward type</label>
            <select
              value={form.rewardType}
              onChange={(e) => updateRewardType(e.target.value as RewardType)}
              className={inputCls}
            >
              {REWARD_TYPE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
              {REWARD_TYPE_OPTIONS.find((r) => r.value === form.rewardType)?.hint}
            </p>
            {recommendedTaskType && !hasRecommendedTask && !isEdit && (
              <p className="mt-2 rounded-lg bg-orange-500/10 px-3 py-2 text-xs text-orange-200 dark:text-orange-200">
                Add a{" "}
                <strong>
                  {QUEST_TASK_TYPE_OPTIONS.find((o) => o.value === recommendedTaskType)?.label}
                </strong>{" "}
                task below so user data is collected for export.
              </p>
            )}
            {(form.rewardType === "INVITE_CODE_RANDOM" ||
              form.rewardType === "INVITE_CODE") && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                After creating the quest, open <strong>Invite codes & draw</strong> to paste
                codes and run the random draw.
              </p>
            )}
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
            {needsMaxWinners && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Max winners / FCFS slots</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required={needsMaxWinners}
                  value={form.maxWinners}
                  onChange={(e) => updateField("maxWinners", e.target.value)}
                  placeholder="e.g. 50"
                  className={inputCls}
                />
              </div>
            )}
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
            className="type-section-title flex w-full items-center justify-between"
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
                        {QUEST_TASK_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">Points</label>
                      <input type="number" min="1" value={task.points} onChange={(e) => updateTask(idx, "points", Number(e.target.value))} className={cn(inputCls, "py-2")} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium">Target / URL / Handle</label>
                      <input
                        value={task.target}
                        onChange={(e) => updateTask(idx, "target", e.target.value)}
                        placeholder="@handle or https://..."
                        className={cn(inputCls, "py-2")}
                      />
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        Label for users: {buildQuestTaskTitle(task.type, task.target)}
                      </p>
                    </div>
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
        <p className="rounded-xl bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-200 dark:text-orange-300">
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
          className="inline-flex items-center gap-2 rounded-full bg-[var(--primary)] px-5 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] shadow-[0_0_20px_rgb(var(--canton-rgb)/0.18)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting && <LoadingSpinner size="md" />}
          {isEdit ? "Save Changes" : "Create Quest"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-full border border-[var(--border)] bg-[var(--card)]/80 px-5 py-2.5 text-sm font-semibold transition-colors hover:border-[var(--primary)]/30 hover:bg-[var(--primary)]/10"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
