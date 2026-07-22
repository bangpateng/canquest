/** Shared types for the Quest system — mirrors the Prisma / NestJS API shapes. */

import type { QuestCampaignSummary } from "@/lib/canton/campaign-reward";
import type { QuestSocialLink } from "@/lib/quest/quest-social-links";

export type QuestStatus = "ACTIVE" | "COMING_SOON" | "ENDED";
export type SubmissionStatus = "PENDING" | "VERIFIED" | "REJECTED";

export type RewardType =
  | "WAITLIST_EMAIL"
  | "INVITE_CODE_RANDOM"
  | "INVITE_CODE_FCFS"
  | "CC_ONLY"
  | "CC_MANUAL"
  | "CC_AND_CODE_RAFFLE";

/**
 * Mode gate akses Earn per-campaign (di-set admin per-event).
 * CC_OR_POINTS = lock CC ATAU spend points (default).
 * CC_ONLY = hanya lock CC. POINTS_ONLY = hanya spend points. NONE = tanpa gate (gratis).
 */
export type EntryGateMode = "CC_OR_POINTS" | "CC_ONLY" | "POINTS_ONLY" | "NONE";

export type QuestRewardState =
  | "in_progress"
  | "waitlist"
  | "winner_fcfs"
  | "fcfs_missed"
  | "fcfs_claimable"
  | "winner"
  | "not_winner"
  | "pending_draw"
  | "cc_reward"
  | "completed"
  | "unknown";

export interface QuestRewardStatus {
  state: QuestRewardState;
  inviteCode: string | null;
  message: string;
  /** CC_AND_CODE_RAFFLE: varian pemenang ('CODE' | 'CC'); null = legacy both / not applicable. */
  rewardVariant?: "CODE" | "CC" | null;
}

export interface QuestTask {
  id: string;
  questId: string;
  type: string;
  title: string;
  description: string | null;
  points: number;
  target: string | null;
  order: number;
  correctAnswer?: string | null;
  showNewBadge?: boolean;
  repeatEvery24h?: boolean;
  createdAt?: string;
}

export interface Quest {
  id: string;
  title: string;
  /** Partner name in social task titles (Follow, Retweet, Telegram, Discord). */
  projectName?: string | null;
  org: string;
  orgSlug: string;
  description: string;
  banner: string;
  bannerImageUrl?: string | null;
  logoUrl?: string | null;
  rewardCc: number;
  rewardPool: string;
  rewardType?: RewardType;
  maxWinners?: number | null;
  claimFeeCc?: number | null;
  /** Custom winner message shown after draw/claim (admin dashboard). */
  winnerMessage?: string | null;
  /** Link register/landing proyek untuk redeem code (shown in "How to use" reveal). */
  redeemUrl?: string | null;
  /** Instruksi custom redeem; kosong = pakai template 3-step default. */
  redeemInstructions?: string | null;
  campaignSummary?: QuestCampaignSummary;
  deadline: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  status: QuestStatus;
  tags: string[];
  socialLinks?: QuestSocialLink[];
  questKind?: "CAMPAIGN" | "EARN_HUB";
  /** Per-event Earn access gate (CAMPAIGN only). Null/undefined = CC_OR_POINTS (default). */
  entryGateMode?: EntryGateMode | null;
  /** Override CC lock requirement (null = global default). */
  entryCcLock?: number | null;
  /** Override points cost (null = global default). */
  entryCostPoints?: number | null;
  createdAt: string;
  tasks: QuestTask[];
}

/** Human labels for admin + display (mirrors backend EntryGateMode enum). */
export const ENTRY_GATE_MODE_OPTIONS: {
  value: EntryGateMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "CC_OR_POINTS",
    label: "CC lock OR Points",
    hint: "User can lock CC or spend points (either one). Default behaviour.",
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
    hint: "Anyone can join without CC lock or points.",
  },
];

export interface QuestSubmission {
  id: string;
  taskId: string;
  status: SubmissionStatus;
  proof: string | null;
  submittedAt: string;
  verifiedAt?: string | null;
}

export interface UserProgress {
  completedQuestIds: string[];
  submittedTaskIds: string[];
  submissions: QuestSubmission[];
}

export const QUEST_STATUS_BADGE: Record<
  QuestStatus,
  { label: string; className: string }
> = {
  ACTIVE: {
    label: "Active",
    className:
      "bg-canton-soft text-canton border border-canton-muted backdrop-blur-sm",
  },
  COMING_SOON: {
    label: "Coming soon",
    className:
      "bg-[rgb(var(--canton-cyan-rgb)/0.12)] text-[rgb(var(--canton-cyan-rgb)/0.95)] border border-[rgb(var(--canton-cyan-rgb)/0.25)]",
  },
  ENDED: {
    label: "Ended",
    className:
      "bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)]",
  },
};

/** Default card hero when no banner image is uploaded. */
export const DEFAULT_QUEST_BANNER =
  "linear-gradient(135deg,rgba(6,182,212,0.42) 0%,rgba(6,182,212,0.18) 40%,rgba(17,24,39,0.40) 100%)";

export const QUEST_BANNER_TAG_PILL =
  "rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-medium leading-tight text-neutral-800 shadow-sm backdrop-blur-md sm:text-[11px] dark:bg-neutral-950/75 dark:text-neutral-100";

/** Task types supported in admin + user UI */
export type QuestTaskType =
  | "daily_check_in"
  | "send_transaction"
  | "send_token"
  | "daily_swap"
  | "send_any_daily"
  | "send_to_user_daily"
  | "receive_external_daily"
  | "receive_internal_daily"
  | "lock_cc"
  | "quiz_yes_no"
  | "quiz_choice"
  | "twitter_follow"
  | "twitter_retweet"
  | "telegram_channel"
  | "telegram_group"
  | "discord_join"
  | "submit_email"
  | "submit_party_id"
  | "submit_canton_address";

/** CanQuest Earn hub (user menu Quest) — admin adds these only */
export const EARN_HUB_TASK_TYPE_OPTIONS: { value: string; label: string; hint?: string }[] = [
  { value: "daily_check_in", label: "Daily check-in", hint: "Once per day · resets at 00:00 UTC" },
  {
    value: "send_transaction",
    label: "Send transaction (custom count)",
    hint: "Wallet required · resets every 24 hours · set any count (1×, 3×, 5×, …) · counts only real completed CC sends (fees & pending offers excluded)",
  },
  {
    value: "send_any_daily",
    label: "Send CC or USDCx — daily",
    hint: "Wallet required · resets at 00:00 UTC · counts real completed outgoing CC + USDCx sends (combined) · set any count",
  },
  {
    value: "send_to_user_daily",
    label: "Send to a CanQuest user — daily",
    hint: "Wallet required · resets at 00:00 UTC · counts only sends whose recipient is a registered CanQuest user (CC + USDCx) · set any count",
  },
  {
    value: "receive_external_daily",
    label: "Receive from external wallet — daily",
    hint: "Wallet required · resets at 00:00 UTC · counts inbound CC/USDCx transfers from a non-CanQuest (external) wallet · requires the ledger indexer extension · set any count",
  },
  {
    value: "receive_internal_daily",
    label: "Receive from a CanQuest user — daily",
    hint: "Wallet required · resets at 00:00 UTC · counts inbound CC/USDCx transfers from a registered CanQuest user · set any count",
  },
  {
    value: "lock_cc",
    label: "Lock CC — tier (3d / 7d / 15d)",
    hint: "Wallet required · one-time per tier · set target = tier termKey (3d, 7d, or 15d) · higher tier auto-completes lower tiers (cascade)",
  },
  { value: "twitter_follow", label: "Follow Twitter CanQuest", hint: "X profile URL" },
  { value: "twitter_retweet", label: "Retweet post CanQuest", hint: "Post URL to retweet" },
  { value: "telegram_channel", label: "Join Telegram channel CanQuest", hint: "t.me/… channel link" },
  { value: "telegram_group", label: "Join Telegram group CanQuest", hint: "t.me/… group link" },
  { value: "discord_join", label: "Join Discord CanQuest", hint: "Discord invite link" },
  {
    value: "quiz_yes_no",
    label: "Quiz — Yes / No",
    hint: "Correct answer earns points; wrong answer earns 0",
  },
  {
    value: "quiz_choice",
    label: "Quiz — A / B / C / D",
    hint: "Multiple choice; set one correct letter",
  },
];

export function earnHubTaskTypeLabel(type: string): string {
  const opt = EARN_HUB_TASK_TYPE_OPTIONS.find((t) => t.value === type);
  return opt?.label ?? questTaskTypeLabel(type);
}

export function isEarnHubQuizType(type: string): boolean {
  return type === "quiz_yes_no" || type === "quiz_choice";
}

export function isEarnHubSocialType(type: string): boolean {
  return isCampaignSocialTaskType(type);
}

/** Partner campaigns (Earn) — social tasks only; no Party ID / email tasks in admin or UI. */
export function isCampaignSocialTaskType(type: string): boolean {
  const t = type === "telegram_join" ? "telegram_channel" : type;
  return (
    t === "twitter_follow" ||
    t === "twitter_retweet" ||
    t === "telegram_channel" ||
    t === "telegram_group" ||
    t === "discord_join"
  );
}

export function filterCampaignParticipantTasks<T extends { type: string }>(
  tasks: T[],
): T[] {
  return tasks.filter((t) => isCampaignSocialTaskType(t.type));
}

/** Short label from X / Telegram / Discord URL or handle (universal for any post). */
export function formatEarnHubSocialTarget(
  type: string,
  target: string | null | undefined,
): string | null {
  if (!target?.trim()) return null;
  const raw = target.trim();

  if (type === "twitter_follow" || type === "twitter_retweet") {
    const asHandle = (h: string) => {
      const clean = h.replace(/^@/, "").split("/")[0]?.split("?")[0] ?? "";
      return clean ? `@${clean}` : null;
    };
    if (!raw.startsWith("http")) {
      return asHandle(raw) ?? raw;
    }
    try {
      const u = new URL(raw);
      const parts = u.pathname.split("/").filter(Boolean);
      const user = parts[0];
      if (!user) return raw;
      const handle = asHandle(user)!;
      if (type === "twitter_follow") return handle;
      if (parts[1] === "status") return `${handle} · post`;
      return handle;
    } catch {
      return asHandle(raw) ?? raw;
    }
  }

  if (type === "telegram_channel" || type === "telegram_group") {
    if (raw.startsWith("http")) {
      try {
        const u = new URL(raw);
        const slug = u.pathname.replace(/^\//, "").split("/")[0];
        return slug ? `t.me/${slug}` : raw;
      } catch {
        return raw;
      }
    }
    return raw.replace(/^@/, "");
  }

  if (type === "discord_join") {
    if (raw.startsWith("http")) {
      try {
        const u = new URL(raw);
        return `${u.hostname}${u.pathname.length > 1 ? u.pathname.slice(0, 20) : ""}`;
      } catch {
        return raw;
      }
    }
    return raw;
  }

  return raw.length > 56 ? `${raw.slice(0, 53)}…` : raw;
}

function normTaskText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9@]/g, "");
}

/** Earn-hub quiz window: NEW label + points only within this period after publish. */
export const EARN_HUB_NEW_LABEL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Daily tasks reset at 00:00 UTC (for WIB users that is 07:00 local time).
 * Mirrors apps/api/src/common/time-utils.ts — keep both in sync.
 */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Milliseconds remaining until the next 00:00 UTC boundary. */
export function msUntilNextUtcDay(now: Date = new Date()): number {
  const next = startOfTodayUtc(now);
  next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

/**
 * Cooldown remaining for repeatable daily tasks = time until the next 00:00 UTC.
 * (Replaces the old rolling-24h-from-last-verify window.)
 */
export const EARN_HUB_REPEAT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Tasks that repeat once per UTC day (reset at 00:00 UTC). Other tasks stay on
 * Quest when done but are one-time (lock-cc is one-time per tier).
 */
export function isEarnHubRepeatableTask(task: { type: string }): boolean {
  return (
    task.type === "daily_check_in" ||
    task.type === "send_transaction" ||
    task.type === "send_token" ||
    task.type === "daily_swap" ||
    task.type === "send_any_daily" ||
    task.type === "send_to_user_daily" ||
    task.type === "receive_external_daily" ||
    task.type === "receive_internal_daily"
  );
}

/** Send-transaction tasks: require the user to make N real CC sends within 24h. */
export function isSendTransactionTask(type: string): boolean {
  return type === "send_transaction";
}

/** Required number of sends for a send-transaction task (stored in task.target). Min 1. */
export function getSendTransactionRequiredCount(target: string | null | undefined): number {
  const n = parseInt((target ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Human title for a send-transaction task ("Send 3 transaction(s)"). */
export function sendTransactionTitle(requiredCount: number): string {
  return `Send ${requiredCount} transaction${requiredCount === 1 ? "" : "s"}`;
}

/** Send-token tasks: require the user to make N real USDCx sends within 24h. */
export function isSendTokenTask(type: string): boolean {
  return type === "send_token";
}

/** Required number of token sends (stored in task.target). Min 1. */
export function getSendTokenRequiredCount(target: string | null | undefined): number {
  const n = parseInt((target ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Human title for a send-token task ("Send 3 USDCx"). */
export function sendTokenTitle(requiredCount: number, instrumentId = "USDCx"): string {
  return `Send ${requiredCount} ${instrumentId}`;
}

/** Daily-swap tasks: require the user to make N real swaps within 24h. */
export function isDailySwapTask(type: string): boolean {
  return type === "daily_swap";
}

/**
 * New count-based daily tasks (send/receive CC+USDCx variants). Like
 * send_transaction, these store a required count in `target` and need the count
 * picker UI in the admin form.
 */
export function isCountBasedDailyTask(type: string): boolean {
  return (
    type === "send_any_daily" ||
    type === "send_to_user_daily" ||
    type === "receive_external_daily" ||
    type === "receive_internal_daily"
  );
}

/** Required count for a count-based daily task (stored in task.target). Min 1. */
export function getCountBasedDailyRequired(target: string | null | undefined): number {
  const n = parseInt((target ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Default title for a count-based daily task based on its type + count. */
export function countBasedDailyTitle(type: string, requiredCount: number): string {
  const base: Record<string, string> = {
    send_any_daily: "Send CC or USDCx",
    send_to_user_daily: "Send to a CanQuest user",
    receive_external_daily: "Receive from an external wallet",
    receive_internal_daily: "Receive from a CanQuest user",
  };
  const label = base[type] ?? "Daily task";
  return `${label} ${requiredCount}×`;
}

/** Required number of swaps (stored in task.target). Min 1. */
export function getDailySwapRequiredCount(target: string | null | undefined): number {
  const n = parseInt((target ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Human title for a daily-swap task ("Daily Swap 3×"). */
export function dailySwapTitle(requiredCount: number): string {
  return `Daily Swap ${requiredCount}×`;
}

/** Lock-CC tasks: one-time per tier. Tier encoded in task.target as termKey. */
export function isLockCcTask(type: string): boolean {
  return type === "lock_cc";
}

/** Lock termKey (3d / 7d / 15d) for a lock-cc task, stored in task.target. */
export function getLockCcTermFromTarget(target: string | null | undefined): string {
  const t = (target ?? "").trim().toLowerCase();
  if (t === "3d" || t === "7d" || t === "15d") return t;
  return "3d";
}

/** Human title for a lock-cc task ("Lock CC — 3 Days"). */
export function lockCcTitle(termKey: string): string {
  const days = termKey.replace(/[^0-9]/g, "");
  return `Lock CC${days ? ` — ${days} Days` : ""}`;
}

/**
 * Time until a repeatable task can be claimed again. Anchor = next 00:00 UTC
 * boundary (daily reset), regardless of when the user last verified.
 *
 * If the user has NOT yet verified today, returns 0 (claimable now). If they
 * already verified today, returns time-to-midnight-UTC.
 */
export function getEarnHubRepeatCooldownMs(
  submission: { verifiedAt?: string | null; submittedAt?: string } | null | undefined,
  now: number = Date.now(),
): number {
  if (!submission) return 0;
  const raw = submission.verifiedAt ?? submission.submittedAt;
  if (!raw) return 0;
  const last = new Date(raw).getTime();
  if (Number.isNaN(last)) return 0;
  const todayStart = startOfTodayUtc(new Date(now)).getTime();
  // Verified before today's UTC midnight → free to claim again now.
  if (last < todayStart) return 0;
  // Verified today → must wait until next 00:00 UTC.
  return msUntilNextUtcDay(new Date(now));
}

export function formatEarnHubCooldown(ms: number): string {
  if (ms <= 0) return "";
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function isEarnHubQuizExpired(
  task: { type: string; createdAt?: string | null },
  now: number = Date.now(),
): boolean {
  if (!isEarnHubQuizType(task.type)) return false;
  if (!task.createdAt) return false;
  const created = new Date(task.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return now - created > EARN_HUB_NEW_LABEL_TTL_MS;
}

/** NEW badge: admin enabled, not completed by user, and within 24h of publish. */
export function shouldShowEarnHubNewLabel(
  task: { showNewBadge?: boolean; createdAt?: string | null },
  opts?: { taskCompleted?: boolean; now?: number },
): boolean {
  if (!task.showNewBadge) return false;
  if (opts?.taskCompleted) return false;
  if (task.createdAt) {
    const created = new Date(task.createdAt).getTime();
    if (Number.isNaN(created)) return true;
    const now = opts?.now ?? Date.now();
    if (now - created > EARN_HUB_NEW_LABEL_TTL_MS) return false;
  }
  return true;
}

/** One headline + optional detail — avoids type label + title + @handle triple repeat. */
export function getEarnHubTaskRowDisplay(
  task: {
    type: string;
    title: string;
    target?: string | null;
    showNewBadge?: boolean;
    createdAt?: string | null;
  },
  opts?: { taskCompleted?: boolean; now?: number },
): {
  category: string;
  headline: string;
  detail: string | null;
  showNew: boolean;
} {
  const category = earnHubTaskTypeLabel(task.type);
  const showNew = shouldShowEarnHubNewLabel(task, opts);
  const customTitle = task.title?.trim() ?? "";
  const targetLine = isEarnHubSocialType(task.type)
    ? formatEarnHubSocialTarget(task.type, task.target)
    : null;

  if (isEarnHubQuizType(task.type)) {
    return {
      category,
      headline: customTitle || "Quiz",
      detail: null,
      showNew,
    };
  }

  if (isEarnHubSocialType(task.type)) {
    return {
      category,
      headline: customTitle || targetLine || category,
      detail: null,
      showNew,
    };
  }

  return {
    category,
    headline: customTitle || category,
    detail: null,
    showNew,
  };
}

/** Map stored task → admin form draft (edit published tasks). */
export function earnHubTaskToDraft(task: {
  type: string;
  title: string;
  points: number;
  target: string | null;
  correctAnswer: string | null;
  showNewBadge?: boolean;
  repeatEvery24h?: boolean;
}): {
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
  repeatEvery24h: boolean;
} {
  const choices = parseQuizChoices(task.target);
  return {
    type: task.type,
    points: task.points,
    title: task.title,
    target: task.target ?? "",
    correctAnswer: task.correctAnswer ?? (task.type === "quiz_choice" ? "A" : "yes"),
    choiceA: choices[0] ?? "",
    choiceB: choices[1] ?? "",
    choiceC: choices[2] ?? "",
    choiceD: choices[3] ?? "",
    showNewBadge: Boolean(task.showNewBadge),
    repeatEvery24h: isEarnHubRepeatableTask({ type: task.type }),
  };
}

export function validateEarnHubTaskDraft(
  draft: {
    type: string;
    title?: string;
    target?: string;
    choiceA?: string;
    choiceB?: string;
    choiceC?: string;
    choiceD?: string;
  },
): string | null {
  if (draft.type === "daily_check_in" && !draft.title?.trim()) {
    return "Enter a title shown on Quest.";
  }
  const needsUrl =
    draft.type === "twitter_follow" ||
    draft.type === "twitter_retweet" ||
    draft.type === "telegram_channel" ||
    draft.type === "telegram_group" ||
    draft.type === "discord_join";
  if (needsUrl && !draft.target?.trim()) {
    return "Link / URL is required for this task type.";
  }
  if (draft.type === "quiz_yes_no" && !draft.title?.trim()) {
    return "Enter the quiz question.";
  }
  if (draft.type === "quiz_choice") {
    if (!draft.title?.trim()) return "Enter the quiz question.";
    const filled = [draft.choiceA, draft.choiceB, draft.choiceC, draft.choiceD].filter((c) =>
      c?.trim(),
    );
    if (filled.length < 2) return "Add at least two answer options (A and B).";
  }
  return null;
}

/** Parse quiz options stored in task.target (pipe-separated or JSON array). */
export function parseQuizChoices(target: string | null | undefined): string[] {
  if (!target?.trim()) return [];
  const raw = target.trim();
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 4);
      }
    } catch {
      /* fall through */
    }
  }
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function buildEarnHubTaskPayload(input: {
  type: string;
  points: number;
  title?: string;
  target?: string;
  correctAnswer?: string;
  showNewBadge?: boolean;
  choiceA?: string;
  choiceB?: string;
  choiceC?: string;
  choiceD?: string;
}): {
  type: string;
  title: string;
  description: string | null;
  points: number;
  target: string | null;
  correctAnswer: string | null;
  showNewBadge: boolean;
  repeatEvery24h: boolean;
} {
  const label = earnHubTaskTypeLabel(input.type);
  const points = Math.max(0, input.points);

  const showNewBadge = Boolean(input.showNewBadge);
  const repeatEvery24h = isEarnHubRepeatableTask({ type: input.type });

  if (input.type === "send_transaction") {
    const required = getSendTransactionRequiredCount(input.target);
    const customTitle = input.title?.trim();
    return {
      type: input.type,
      title: customTitle || sendTransactionTitle(required),
      description: null,
      points,
      // required send count is stored in target
      target: String(required),
      correctAnswer: null,
      showNewBadge,
      repeatEvery24h: true,
    };
  }

  // New count-based daily tasks (send/receive variants): store required count
  // in target, same shape as send_transaction.
  if (isCountBasedDailyTask(input.type)) {
    const required = getCountBasedDailyRequired(input.target);
    const customTitle = input.title?.trim();
    return {
      type: input.type,
      title: customTitle || countBasedDailyTitle(input.type, required),
      description: null,
      points,
      target: String(required),
      correctAnswer: null,
      showNewBadge,
      repeatEvery24h: true,
    };
  }

  if (input.type === "quiz_yes_no") {
    const q = input.title?.trim() || "Quiz question";
    const ans = (input.correctAnswer ?? "yes").toLowerCase();
    return {
      type: input.type,
      title: q,
      description: null,
      points,
      target: null,
      correctAnswer: ans === "no" ? "no" : "yes",
      showNewBadge,
      repeatEvery24h,
    };
  }

  if (input.type === "quiz_choice") {
    const q = input.title?.trim() || "Quiz question";
    const choices = [input.choiceA, input.choiceB, input.choiceC, input.choiceD]
      .map((c) => c?.trim())
      .filter(Boolean) as string[];
    const letter = (input.correctAnswer ?? "A").toUpperCase().slice(0, 1);
    return {
      type: input.type,
      title: q,
      description: null,
      points,
      target: choices.length > 0 ? choices.join("|") : null,
      correctAnswer: letter,
      showNewBadge,
      repeatEvery24h,
    };
  }

  if (input.type === "daily_check_in") {
    return {
      type: input.type,
      title: input.title?.trim() || "Daily check-in",
      description: null,
      points,
      target: null,
      correctAnswer: null,
      showNewBadge,
      repeatEvery24h: true,
    };
  }

  const target = input.target?.trim() || null;
  const targetLine = formatEarnHubSocialTarget(input.type, target);
  const customTitle = input.title?.trim();
  return {
    type: input.type,
    title: customTitle || targetLine || label,
    description: null,
    points,
    target,
    correctAnswer: null,
    showNewBadge,
    repeatEvery24h,
  };
}

/** Admin: partner campaign tasks (social only). */
export const CAMPAIGN_TASK_TYPE_OPTIONS: { value: QuestTaskType; label: string }[] = [
  { value: "twitter_follow", label: "Follow on X" },
  { value: "twitter_retweet", label: "Retweet on X" },
  { value: "telegram_channel", label: "Join Telegram channel" },
  { value: "telegram_group", label: "Join Telegram group" },
  { value: "discord_join", label: "Join Discord" },
];

/** Legacy / internal — includes data-collection types not offered for new campaigns. */
export const QUEST_TASK_TYPE_OPTIONS: { value: QuestTaskType; label: string }[] = [
  ...CAMPAIGN_TASK_TYPE_OPTIONS,
  { value: "submit_email", label: "Submit Email" },
  { value: "submit_party_id", label: "Submit Party ID (auto-filled)" },
];

export const REWARD_TYPE_OPTIONS: { value: RewardType; label: string; hint: string }[] = [
  {
    value: "INVITE_CODE_FCFS",
    label: "1 · Kode waitlist (FCFS)",
    hint:
      "User selesaikan sosial → submit quest → bayar claim fee (default 2 CC) → dapat kode dari pool. Upload kode di Winners.",
  },
  {
    value: "INVITE_CODE_RANDOM",
    label: "2 · Kode waitlist (raffle)",
    hint:
      "Setelah event: admin Draw Winners → pemenang bayar claim fee → kode muncul. Yang kalah: You Not Lucky.",
  },
  {
    value: "WAITLIST_EMAIL",
    label: "3 · Waitlist email (raffle)",
    hint:
      "Task Submit Email + pesan kustom pemenang (winner message). Draw di admin; pemenang lihat pesan admin.",
  },
  {
    value: "CC_ONLY",
    label: "4 · Token CC (FCFS)",
    hint:
      "Max winners = slot FCFS. User claim dengan fee (default 3 CC) → CC dari pool validator. Bukan bulk manual.",
  },
  {
    value: "CC_MANUAL",
    label: "5 · Token CC (raffle / manual draw)",
    hint:
      "Setelah event: admin Draw Winners → pemenang dapat notifikasi & claim CC (bukan FCFS). Yang kalah: You Not Lucky.",
  },
  {
    value: "CC_AND_CODE_RAFFLE",
    label: "6 · CC + Kode (Raffle Gabungan)",
    hint:
      "Satu event gabungan: user selesaikan semua task sosial → submit → tunggu raffle. Admin draw pemenang dari dashboard. Pemenang claim CC reward + invite code dengan membayar 5 CC claim fee.",
  },
];

/** Admin export button label per reward type. */
export function questExportLabel(rewardType: RewardType | string): string {
  switch (rewardType) {
    case "WAITLIST_EMAIL":
      return "Download waitlist CSV";
    case "CC_ONLY":
    case "CC_MANUAL":
      return "Download CC + Party ID CSV";
    case "INVITE_CODE_RANDOM":
    case "INVITE_CODE_FCFS":
    case "INVITE_CODE": // legacy fallback — data lama di DB
      return "Download draw results CSV";
    default:
      return "Download activity CSV";
  }
}

export function isInviteRewardType(rewardType: RewardType | string): boolean {
  return (
    rewardType === "INVITE_CODE_RANDOM" ||
    rewardType === "INVITE_CODE" || // legacy fallback — data lama di DB
    rewardType === "INVITE_CODE_FCFS"
  );
}

export const TASK_COUNTDOWN_SEC = 5;

/** Countdown label shown while verifying social / link tasks. */
export function formatTaskCountdownSeconds(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  return n === 1 ? "1 second" : `${n} seconds`;
}

export type QuestTaskTitleContext = {
  /** Partner name from admin `projectName` (or quest title). */
  projectName?: string | null;
  questKind?: "CAMPAIGN" | "EARN_HUB";
};

/** Resolve display name for campaign social task labels. */
export function resolveQuestProjectName(
  quest: Pick<Quest, "title" | "projectName">,
): string {
  return quest.projectName?.trim() || quest.title;
}

/** Social tasks use the partner project name in titles. */
export function usesCampaignProjectNameInTitle(type: string): boolean {
  return isCampaignSocialTaskType(type);
}

function normalizeTaskType(type: string): string {
  return type === "telegram_join" ? "telegram_channel" : type;
}

/** Partner campaign task labels — project name only on social types. */
function campaignTaskTypeLabel(type: string, projectName: string): string {
  if (!usesCampaignProjectNameInTitle(type)) {
    const opt = QUEST_TASK_TYPE_OPTIONS.find((t) => t.value === type);
    return opt?.label ?? type.replace(/_/g, " ");
  }
  const name = projectName.trim() || "Project";
  switch (normalizeTaskType(type)) {
    case "twitter_follow":
      return `Follow ${name} on X`;
    case "twitter_retweet":
      return `Retweet ${name} on X`;
    case "telegram_channel":
      return `Join Telegram ${name}`;
    case "telegram_group":
      return `Join Telegram group ${name}`;
    case "discord_join":
      return `Join Discord ${name}`;
    default:
      return QUEST_TASK_TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type.replace(/_/g, " ");
  }
}

function shouldAppendTargetToTitle(type: string, target: string): boolean {
  const t = normalizeTaskType(type);
  if (t === "twitter_follow" || t === "twitter_retweet") return true;
  if (target.startsWith("@")) return true;
  if (target.startsWith("http") && (t === "twitter_follow" || t === "twitter_retweet")) return true;
  return false;
}

/** Admin/UI label for a quest task type. */
export function questTaskTypeLabel(type: string, ctx?: QuestTaskTitleContext): string {
  if (ctx?.questKind === "CAMPAIGN") {
    return campaignTaskTypeLabel(type, ctx.projectName ?? "");
  }
  if (ctx?.questKind === "EARN_HUB") {
    const earn = EARN_HUB_TASK_TYPE_OPTIONS.find((t) => t.value === type);
    if (earn) return earn.label;
  }
  if (ctx?.projectName?.trim()) {
    return campaignTaskTypeLabel(type, ctx.projectName);
  }
  const opt = QUEST_TASK_TYPE_OPTIONS.find((t) => t.value === type);
  if (opt) return opt.label;
  const earn = EARN_HUB_TASK_TYPE_OPTIONS.find((t) => t.value === type);
  if (earn) return earn.label;
  if (type === "telegram_join") return "Join Telegram Channel";
  return type.replace(/_/g, " ");
}

/** Auto title when admin saves a task (campaign uses project name). */
export function buildQuestTaskTitle(
  type: string,
  target?: string | null,
  ctx?: QuestTaskTitleContext,
): string {
  const label = questTaskTypeLabel(type, ctx);
  const t = target?.trim();
  if (!t || !shouldAppendTargetToTitle(type, t)) return label;
  const short = t.length > 48 ? `${t.slice(0, 45)}…` : t;
  return `${label} — ${short}`;
}

/** Title shown to users — fixes legacy DB rows that still say "CanQuest". */
export function resolveQuestTaskDisplayTitle(
  task: Pick<QuestTask, "type" | "title" | "target">,
  quest: Pick<Quest, "title" | "projectName" | "questKind">,
): string {
  if (quest.questKind === "EARN_HUB") return task.title;
  if (!usesCampaignProjectNameInTitle(task.type)) return task.title;
  return buildQuestTaskTitle(task.type, task.target, {
    projectName: resolveQuestProjectName(quest),
    questKind: "CAMPAIGN",
  });
}

/** Display deadline on cards from Ends at (replaces manual deadline field). */
export function formatQuestDeadlineDisplay(
  endsAtIso: string | null | undefined,
): string | null {
  if (!endsAtIso) return null;
  const d = new Date(endsAtIso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const TASK_ACTION_BUTTON_LABEL: Record<string, string> = {
  daily_check_in: "Check in",
  send_transaction: "Verify",
  send_token: "Verify",
  daily_swap: "Verify",
  send_any_daily: "Verify",
  send_to_user_daily: "Verify",
  receive_external_daily: "Verify",
  receive_internal_daily: "Verify",
  lock_cc: "Verify",
  quiz_yes_no: "Answer",
  quiz_choice: "Answer",
  twitter_follow: "Twitter",
  twitter_retweet: "Twitter",
  telegram_channel: "Telegram",
  telegram_group: "Telegram",
  telegram_join: "Telegram",
  discord_join: "Discord",
  submit_email: "Email",
  submit_party_id: "Party",
  submit_canton_address: "Canton",
};
