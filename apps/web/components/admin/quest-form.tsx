"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { Plus, Trash2, ChevronDown, ChevronUp, Upload } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  QUEST_TASK_TYPE_OPTIONS,
  buildQuestTaskTitle,
  DEFAULT_QUEST_BANNER,
  formatQuestDeadlineDisplay,
  resolveQuestProjectName,
} from "@/lib/quest/quest-types";
import {
  getRewardConfig,
  validateQuestForm,
  type ActiveRewardCode,
} from "@/lib/quest/quest-engine";
import { isInviteRewardType } from "@/lib/quest/quest-types";
import { RewardTypePicker } from "@/components/admin/reward-type-picker";
import type { QuestSocialLink } from "@/lib/quest/quest-social-links";
import { QuestSocialLinksEditor } from "@/components/admin/quest-social-links-editor";

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

/** Per-event Earn access gate mode options (mirrors backend EntryGateMode enum). */
const ENTRY_GATE_MODE_OPTIONS: {
  value: string;
  label: string;
  hint: string;
}[] = [
  {
    value: "CC_OR_POINTS",
    label: "CC lock OR Points",
    hint: "Default. User can lock CC or spend points (either one).",
  },
  {
    value: "CC_ONLY",
    label: "CC lock only",
    hint: "User must lock the required CC. No points path.",
  },
  {
    value: "POINTS_ONLY",
    label: "Points only",
    hint: "User must spend the required points. No CC lock path.",
  },
  {
    value: "NONE",
    label: "No gate (free)",
    hint: "Anyone can join without CC lock or points. Use for free events.",
  },
];

export type AdminQuestKind = "CAMPAIGN" | "EARN_HUB";

interface QuestFormProps {
  questKind?: AdminQuestKind;
  /** After create, redirect to manage page; list link uses redirectBase */
  redirectBase?: string;
  initialData?: {
    id: string;
    title: string;
    projectName?: string | null;
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
    codeWinnersQuota?: number | null;
    claimFeeCc?: number | null;
    winnerMessage?: string | null;
    redeemUrl?: string | null;
    redeemInstructions?: string | null;
    tags: string[];
    socialLinks?: QuestSocialLink[];
    startsAt?: string | null;
    endsAt?: string | null;
    /** Per-event Earn access gate (CAMPAIGN only). */
    entryGateMode?: string | null;
    entryCcLock?: number | null;
    entryCostPoints?: number | null;
  };
}

export function QuestForm({
  initialData,
  questKind = "CAMPAIGN",
}: QuestFormProps) {
  const router = useRouter();
  const isEdit = !!initialData?.id;

  // Normalize legacy reward types on load
  const initialRewardType = (): ActiveRewardCode => {
    const rt = initialData?.rewardType;
    if (!rt) return "CC_ONLY";
    const config = getRewardConfig(rt);
    return config.code;
  };

  const [form, setForm] = useState({
    title: initialData?.title ?? "",
    projectName: initialData?.projectName ?? "",
    org: initialData?.org ?? "",
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
    rewardType: initialRewardType(),
    maxWinners: String(initialData?.maxWinners ?? ""),
    codeWinnersQuota:
      initialData && (initialData as Record<string, unknown>).codeWinnersQuota != null
        ? String((initialData as Record<string, unknown>).codeWinnersQuota)
        : "",
    claimFeeCc: initialData?.claimFeeCc != null ? String(initialData.claimFeeCc) : "",
    winnerMessage: initialData?.winnerMessage ?? "",
    redeemUrl: initialData?.redeemUrl ?? "",
    redeemInstructions: initialData?.redeemInstructions ?? "",
    tags: (initialData?.tags ?? []).join(", "),
    // Per-event Earn access gate (CAMPAIGN only). Empty = global default.
    entryGateMode: initialData?.entryGateMode ?? "CC_OR_POINTS",
    entryCcLock: initialData?.entryCcLock != null ? String(initialData.entryCcLock) : "",
    entryCostPoints:
      initialData?.entryCostPoints != null ? String(initialData.entryCostPoints) : "",
  });

  const [socialLinks, setSocialLinks] = useState<QuestSocialLink[]>(
    initialData?.socialLinks ?? [],
  );
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

  async function deleteQuestAsset(url: string): Promise<void> {
    const trimmed = url.trim();
    if (!trimmed) return;
    const res = await fetch("/api/admin/uploads/quest-asset", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
    });
    const data = (await res.json()) as { message?: string };
    if (!res.ok) throw new Error(data.message ?? "Failed to remove image from storage");
  }

  /** Delete storage object when replacing an upload not yet saved on the quest. */
  function discardUnsavedQuestAsset(url: string, savedUrl: string | null | undefined) {
    const trimmed = url.trim();
    const saved = (savedUrl ?? "").trim();
    if (!trimmed || trimmed === saved) return;
    void deleteQuestAsset(trimmed).catch((err: unknown) => {
      setUploadMsg(err instanceof Error ? err.message : "Could not delete previous image");
    });
  }

  function removeQuestAsset(
    field: "bannerImageUrl" | "logoUrl",
    currentUrl: string,
    savedUrl: string | null | undefined,
  ) {
    const trimmed = currentUrl.trim();
    updateField(field, "");
    setUploadMsg(null);
    if (!trimmed) return;
    void deleteQuestAsset(trimmed)
      .then(() => {
        if (isEdit && trimmed === (savedUrl ?? "").trim()) {
          setUploadMsg("Image removed from storage. Save the campaign to update Earn.");
        }
      })
      .catch((err: unknown) => {
        setUploadMsg(err instanceof Error ? err.message : "Could not remove image from storage");
      });
  }

  function updateField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Update reward type and auto-fill claim fee from quest-engine config. */
  function updateRewardType(value: string) {
    const config = getRewardConfig(value);
    const noCc = !config.needsCcAmount;
    const claimFee = config.defaultClaimFee;
    setForm((prev) => ({
      ...prev,
      rewardType: config.code,
      rewardCc: noCc ? "0" : prev.rewardCc,
      claimFeeCc: claimFee != null ? String(claimFee) : prev.claimFeeCc,
    }));
  }

  // Field visibility driven by quest-engine config
  const rewardConfig = getRewardConfig(form.rewardType);
  const showCcField = rewardConfig.needsCcAmount;
  const needsMaxWinners = rewardConfig.needsMaxWinners;

  const recommendedTaskType =
    questKind === "CAMPAIGN" && form.rewardType === "WAITLIST_EMAIL"
      ? "submit_email"
      : questKind === "CAMPAIGN" &&
          (form.rewardType === "CC_ONLY" ||
            form.rewardType === "CC_MANUAL" ||
            form.rewardType === "CC_AND_CODE_RAFFLE")
        ? "submit_party_id"
        : null;
  const hasRecommendedTask =
    !recommendedTaskType ||
    tasks.some((t) => t.type === recommendedTaskType);

  const taskTitleContext = {
    projectName: resolveQuestProjectName({
      title: form.title,
      projectName: form.projectName,
    }),
    questKind,
  };

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
      const cc = Number(form.rewardCc) || 0;
      const maxW = form.maxWinners.trim() === "" ? null : Number(form.maxWinners);

      // Validate using quest-engine
      const formErrors = validateQuestForm({
        title: form.title,
        org: form.org,
        description: form.description,
        rewardType: form.rewardType,
        rewardCc: cc,
        maxWinners: maxW,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
      });

      if (formErrors.length > 0) {
        setError(formErrors[0]?.message ?? "Validation error");
        setSubmitting(false);
        return;
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

      const rewardCcPayload = rewardConfig.needsCcAmount ? cc : 0;

      // Auto-generate orgSlug from org (first letters of each word, uppercased, max 4 chars)
      const orgSlug =
        (initialData?.orgSlug && form.org === initialData.org
          ? initialData.orgSlug
          : form.org.trim().split(/\s+/).map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 4)) || form.org.slice(0, 3).toUpperCase();

      // Auto-generate reward pool label from reward type
      const autoPoolLabel = (() => {
        if (rewardConfig.isCcToken && cc > 0 && maxW && maxW > 0) return `${cc * maxW} CC pool`;
        if (rewardConfig.isCcToken && cc > 0) return `${cc} CC`;
        if (rewardConfig.isDual && cc > 0) return `${cc} CC + Code`;
        if (maxW && maxW > 0) return `${maxW} ${rewardConfig.code === "WAITLIST_EMAIL" ? "spots" : "codes"}`;
        return "TBD";
      })();

      const payload = {
        title: form.title,
        ...(questKind === "CAMPAIGN" && {
          projectName: form.projectName.trim() || null,
        }),
        org: form.org,
        orgSlug,
        description: form.description,
        banner: (isEdit && initialData?.banner) || DEFAULT_QUEST_BANNER,
        bannerImageUrl: form.bannerImageUrl.trim() || null,
        logoUrl: form.logoUrl.trim() || null,
        rewardCc: rewardCcPayload,
        rewardPool: form.rewardPool.trim() || autoPoolLabel,
        deadline: form.endsAt
          ? formatQuestDeadlineDisplay(new Date(form.endsAt).toISOString())
          : null,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
        status: form.status,
        rewardType: form.rewardType,
        maxWinners: maxW,
        codeWinnersQuota:
          form.rewardType === "CC_AND_CODE_RAFFLE" && form.codeWinnersQuota.trim()
            ? Number(form.codeWinnersQuota)
            : null,
        claimFeeCc: form.claimFeeCc.trim() ? Number(form.claimFeeCc) : null,
        winnerMessage: form.winnerMessage.trim() || null,
        redeemUrl: form.redeemUrl.trim() || null,
        redeemInstructions: form.redeemInstructions.trim() || null,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        ...(questKind === "CAMPAIGN" && {
          socialLinks: socialLinks.filter((l) => l.url.trim()),
        }),
        // Per-event Earn access gate (CAMPAIGN only).
        ...(questKind === "CAMPAIGN" && {
          entryGateMode: form.entryGateMode,
          // Empty string → null (clear override → global default).
          entryCcLock: form.entryCcLock.trim() ? Number(form.entryCcLock) : null,
          entryCostPoints: form.entryCostPoints.trim()
            ? Number(form.entryCostPoints)
            : null,
        }),
        ...(!isEdit && { questKind }),
        ...(tasks.length > 0 && {
          tasks: tasks.map((t, i) => ({
            type: t.type,
            title: buildQuestTaskTitle(t.type, t.target, taskTitleContext),
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
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--primary)]">1</span>
          <h2 className="type-section-title">Identity</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Campaign title *</label>
            <input required value={form.title} onChange={(e) => updateField("title", e.target.value)} placeholder="e.g. Alpend on Canton — Wave 1" className={inputCls} />
          </div>
          {questKind === "CAMPAIGN" ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Project name</label>
              <input
                value={form.projectName}
                onChange={(e) => updateField("projectName", e.target.value)}
                placeholder="e.g. Alpend"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Used in social task titles: Follow, Retweet, Telegram, Discord. Leave empty to use campaign title.
              </p>
            </div>
          ) : null}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Organization *</label>
            <input required value={form.org} onChange={(e) => updateField("org", e.target.value)} placeholder="e.g. Digital Asset Collective" className={inputCls} />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Slug auto-generated from this name (shown on cards when no logo).
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Status</label>
            <select value={form.status} onChange={(e) => updateField("status", e.target.value)} className={inputCls}>
              {QUEST_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Description *</label>
          <textarea required rows={3} value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Describe the quest goals and tasks..." className={cn(inputCls, "resize-none")} />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium">Tags (comma-separated)</label>
          <input value={form.tags} onChange={(e) => updateField("tags", e.target.value)} placeholder="Live, Featured, Learning" className={inputCls} />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Shown as small chips on Earn cards (up to 4).
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Starts at</label>
            <input type="datetime-local" value={form.startsAt} onChange={(e) => updateField("startsAt", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Ends at</label>
            <input type="datetime-local" value={form.endsAt} onChange={(e) => updateField("endsAt", e.target.value)} className={inputCls} />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Shown on cards as the deadline.
            </p>
          </div>
        </div>

        {/* Logo + Banner uploads in one row */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Logo */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Project logo</label>
            <p className="mb-2 text-xs text-[var(--muted-foreground)]">
              Square (JPEG/PNG/WebP/GIF, max 5 MB). Empty → org initials.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {form.logoUrl ? (
                <img src={form.logoUrl} alt="" className="h-14 w-14 rounded-xl border border-[var(--border)] object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/40 text-xs font-semibold text-[var(--muted-foreground)]">
                  {(form.org || "—").slice(0, 2).toUpperCase()}
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
                    const previous = form.logoUrl;
                    void uploadQuestAsset(f)
                      .then((url) => {
                        discardUnsavedQuestAsset(previous, initialData?.logoUrl);
                        updateField("logoUrl", url);
                      })
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
                  onClick={() => removeQuestAsset("logoUrl", form.logoUrl, initialData?.logoUrl)}
                  className="text-sm font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          {/* Banner */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Event banner image</label>
            <p className="mb-2 text-xs text-[var(--muted-foreground)]">
              Wide image on cards (JPEG/PNG/WebP/GIF, max 5 MB). Optional.
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
                    const previous = form.bannerImageUrl;
                    void uploadQuestAsset(f)
                      .then((url) => {
                        discardUnsavedQuestAsset(previous, initialData?.bannerImageUrl);
                        updateField("bannerImageUrl", url);
                      })
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
                  onClick={() =>
                    removeQuestAsset("bannerImageUrl", form.bannerImageUrl, initialData?.bannerImageUrl)
                  }
                  className="text-sm font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {form.bannerImageUrl ? (
          <div
            className="h-24 rounded-xl border border-[var(--border)] bg-cover bg-center"
            style={{ backgroundImage: `url("${form.bannerImageUrl}")` }}
          />
        ) : null}
      </section>

      {/* Reward */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--primary)]">2</span>
          <h2 className="type-section-title">Reward</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Reward type</label>
            <RewardTypePicker
              value={form.rewardType}
              onChange={updateRewardType}
            />
            {recommendedTaskType && !hasRecommendedTask && !isEdit && questKind === "CAMPAIGN" && (
              <p className="mt-2 rounded-lg bg-orange-500/10 px-3 py-2 text-xs text-orange-200 dark:text-orange-200">
                Add a{" "}
                <strong>
                  {QUEST_TASK_TYPE_OPTIONS.find((o) => o.value === recommendedTaskType)?.label}
                </strong>{" "}
                task below so user data is collected for export.
              </p>
            )}
            {(form.rewardType === "INVITE_CODE_RANDOM") && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                After creating the quest, open <strong>Invite codes & draw</strong> to paste
                codes and run the random draw.
              </p>
            )}
          </div>
          <div className={cn("grid gap-4", showCcField ? "sm:grid-cols-2" : "sm:grid-cols-1 sm:max-w-xs")}>
            {showCcField && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">CC / Winners</label>
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
            {form.rewardType === "CC_AND_CODE_RAFFLE" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Code winners quota
                  <span className="ml-1.5 text-xs font-normal text-[var(--muted-foreground)]">
                    (the rest get CC; leave empty = everyone gets both)
                  </span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.codeWinnersQuota}
                  onChange={(e) => updateField("codeWinnersQuota", e.target.value)}
                  placeholder="e.g. 6 (of 10 winners get Code)"
                  className={inputCls}
                />
              </div>
            )}
          </div>
          {(form.rewardType === "WAITLIST_EMAIL" ||
            form.rewardType === "CC_MANUAL" ||
            form.rewardType === "CC_AND_CODE_RAFFLE" ||
            form.rewardType === "INVITE_CODE_RANDOM") && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                {form.rewardType === "CC_AND_CODE_RAFFLE"
                  ? "Winner message (shown after draw)"
                  : "Winner message (custom)"}
              </label>
              <textarea
                value={form.winnerMessage}
                onChange={(e) => updateField("winnerMessage", e.target.value)}
                rows={3}
                placeholder={
                  form.rewardType === "CC_AND_CODE_RAFFLE"
                    ? "e.g. Congratulations! You have been selected as a winner. Claim your CC + Code now."
                    : form.rewardType === "CC_MANUAL"
                      ? "e.g. Congratulations! CC reward will be sent to your wallet."
                      : "e.g. Please check your inbox for KYC steps."
                }
                className={cn(inputCls, "resize-y")}
              />
              {form.rewardType === "CC_AND_CODE_RAFFLE" && (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Shown to winners after admin draw. Non-winners see &ldquo;You weren&rsquo;t selected&rdquo;.
                </p>
              )}
            </div>
          )}

          {/* How to use your code — only for invite-code reward types. */}
          {(isInviteRewardType(form.rewardType) || rewardConfig.isDual) && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  How to use your code
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  Shown to winners after they claim their code. Leave both empty to skip the section.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Register / redeem URL</label>
                <input
                  type="url"
                  value={form.redeemUrl}
                  onChange={(e) => updateField("redeemUrl", e.target.value)}
                  placeholder="https://app.project.io/register"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Opens as an &ldquo;Open&rdquo; button in the default 3-step template.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Custom instructions
                  <span className="ml-1.5 text-xs font-normal text-[var(--muted-foreground)]">
                    (optional)
                  </span>
                </label>
                <textarea
                  value={form.redeemInstructions}
                  onChange={(e) => updateField("redeemInstructions", e.target.value)}
                  rows={3}
                  placeholder={"e.g. 1. Register at the link above\n2. Paste your code at checkout\n3. Your account is credited"}
                  className={cn(inputCls, "resize-y font-mono text-xs")}
                />
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Leave empty to use the default 3-step template (Register &rarr; Enter code &rarr; Done).
                </p>
              </div>
            </div>
          )}

          {/* Reward pool preview — auto-generated, no manual input */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2.5">
            <p className="text-xs font-medium text-[var(--muted-foreground)]">Reward pool label (auto)</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--foreground)]">
              {(() => {
                const cc = Number(form.rewardCc) || 0;
                const maxW = form.maxWinners.trim() === "" ? null : Number(form.maxWinners);
                if (rewardConfig.isCcToken && cc > 0 && maxW && maxW > 0) return `${cc * maxW} CC pool`;
                if (rewardConfig.isCcToken && cc > 0) return `${cc} CC`;
                if (rewardConfig.isDual && cc > 0) return `${cc} CC + Code`;
                if (maxW && maxW > 0) return `${maxW} ${rewardConfig.code === "WAITLIST_EMAIL" ? "spots" : "codes"}`;
                return "TBD";
              })()}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              {questKind === "CAMPAIGN"
                ? "Auto-derived from CC amount & max winners. Task points count toward the leaderboard."
                : "Auto-derived from CC amount & max winners."}
            </p>
          </div>

          {/* Advanced — claim fee (collapsible) */}
          <details className="group rounded-lg border border-[var(--border)] bg-[var(--muted)]/20">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium">
              <span>Advanced — claim fee</span>
              <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-[var(--border)] px-3 py-3">
              <label className="mb-1.5 block text-sm font-medium">Claim fee (CC on-chain)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.claimFeeCc}
                onChange={(e) => updateField("claimFeeCc", e.target.value)}
                placeholder={
                  rewardConfig.defaultClaimFee != null
                    ? `Default ${rewardConfig.defaultClaimFee}`
                    : "No fee"
                }
                className={inputCls}
              />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Leave empty to use the default for this reward type ({rewardConfig.defaultClaimFee != null ? `${rewardConfig.defaultClaimFee} CC` : "no fee"}).
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* Social Links */}
      {questKind === "CAMPAIGN" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--primary)]">3</span>
            <h2 className="type-section-title">Social links</h2>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Small icons shown on the campaign page (X, Discord, Telegram, website, etc.).
          </p>
          <QuestSocialLinksEditor
            links={socialLinks}
            onChange={setSocialLinks}
            inputCls={inputCls}
          />
        </section>
      ) : null}

      {/* Earn access gate — CAMPAIGN only */}
      {questKind === "CAMPAIGN" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--primary)]">
              4
            </span>
            <h2 className="type-section-title">Earn access gate</h2>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Requirement to join this event. Users see an &ldquo;Eligible / Not eligible&rdquo;
            badge on the campaign page based on these settings.
          </p>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Gate mode</label>
              <select
                value={form.entryGateMode}
                onChange={(e) => updateField("entryGateMode", e.target.value)}
                className={inputCls}
              >
                {ENTRY_GATE_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {ENTRY_GATE_MODE_OPTIONS.find((o) => o.value === form.entryGateMode)?.hint}
              </p>
            </div>

            {form.entryGateMode !== "NONE" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {(form.entryGateMode === "CC_OR_POINTS" ||
                  form.entryGateMode === "CC_ONLY") && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      CC lock required
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.entryCcLock}
                      onChange={(e) => updateField("entryCcLock", e.target.value)}
                      placeholder="Global default (30)"
                      className={inputCls}
                    />
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Amount of CC the user must lock on-chain. Leave empty to use the
                      global default.
                    </p>
                  </div>
                )}
                {(form.entryGateMode === "CC_OR_POINTS" ||
                  form.entryGateMode === "POINTS_ONLY") && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Points to spend
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={form.entryCostPoints}
                      onChange={(e) =>
                        updateField("entryCostPoints", e.target.value)
                      }
                      placeholder="Global default (200)"
                      className={inputCls}
                    />
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Points deducted from the user&rsquo;s balance to join. Leave empty to
                      use the global default.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-lg bg-[var(--muted)]/30 px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
                No access requirement — any logged-in user can join this event for free.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {/* Tasks (optional at creation) */}
      {!isEdit && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 space-y-4">
          <button
            type="button"
            onClick={() => setShowTasks((v) => !v)}
            className="type-section-title flex w-full items-center justify-between"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[11px] font-bold text-[var(--primary)]">{questKind === "CAMPAIGN" ? "5" : "3"}</span>
              Tasks ({tasks.length})
            </span>
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
                        Label for users:{" "}
                        {buildQuestTaskTitle(task.type, task.target, taskTitleContext)}
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
          className={cn(buttonVariants(), "gap-2 disabled:opacity-60")}
        >
          {submitting && <LoadingSpinner size="md" />}
          {isEdit ? "Save Changes" : "Create Quest"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className={buttonVariants({ variant: "secondary" })}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
