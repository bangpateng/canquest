/**
 * quest-engine.ts — Single source of truth for all reward type logic.
 *
 * Every UI component, admin form, and card/row renderer imports from here.
 * No reward logic should live in individual component files.
 *
 * Covers:
 *  1. REWARD_CONFIG — static config for 6 active reward types
 *  2. getRewardConfig() — resolve config with legacy fallback
 *  3. getQuestMeta() — derived UI state for cards/rows/sidebar
 *  4. validateQuestForm() — admin form validation
 *  5. getActiveRewardTypes() — picker options for admin form
 */

import type {
  Quest,
  QuestStatus,
  RewardType,
  UserProgress,
} from "@/lib/quest/quest-types";
import type { QuestCampaignSummary } from "@/lib/canton/campaign-reward";
import {
  fcfsSlotsTaken,
  formatFcfsSlotsFilled,
  formatPoolTotalLabel,
  hasParticipatedInQuest,
  isFcfsSlotsFull,
} from "@/lib/canton/campaign-reward";

// ═══════════════════════════════════════════════════════════════
// 1. REWARD_CONFIG — 6 active reward types
// ═══════════════════════════════════════════════════════════════

/** Active reward type codes used in the system. */
export type ActiveRewardCode =
  | "CC_ONLY"
  | "CC_MANUAL"
  | "INVITE_CODE_FCFS"
  | "INVITE_CODE_RANDOM"
  | "WAITLIST_EMAIL"
  | "CC_AND_CODE_RAFFLE";

/** Legacy reward type codes — mapped to active types. */
export type LegacyRewardCode = "CC_AND_INVITE" | "INVITE_CODE";

/** All known reward codes (active + legacy). */
export type KnownRewardCode = ActiveRewardCode | LegacyRewardCode;

export interface RewardConfig {
  /** DB code */
  code: ActiveRewardCode;
  /** Full user-facing label */
  label: string;
  /** Short label for badges/chips */
  shortLabel: string;

  // ── Reward characteristics ──
  /** Reward pays CC tokens */
  isCcToken: boolean;
  /** Dual reward: CC + invite code */
  isDual: boolean;
  /** FCFS (first-come-first-serve) claim style */
  isFcfs: boolean;
  /** Raffle / draw claim style */
  isRaffle: boolean;

  // ── Admin form requirements ──
  /** CC/Winners field required */
  needsCcAmount: boolean;
  /** Max winners / FCFS slots field required */
  needsMaxWinners: boolean;
  /** Default on-chain claim fee (CC); null = no fee */
  defaultClaimFee: number | null;

  /** Admin hint — 1 sentence, Bahasa Indonesia */
  adminHint: string;

  // ── Tailwind classes ──
  /** Badge chip style */
  chipClass: string;
  /** Accent color for text/icons */
  accentClass: string;
}

const REWARD_CONFIGS: Record<ActiveRewardCode, RewardConfig> = {
  CC_ONLY: {
    code: "CC_ONLY",
    label: "Token FCFS",
    shortLabel: "CC FCFS",
    isCcToken: true,
    isDual: false,
    isFcfs: true,
    isRaffle: false,
    needsCcAmount: true,
    needsMaxWinners: true,
    defaultClaimFee: 3,
    adminHint:
      "User selesaikan task → bayar 3 CC fee → terima CC reward. Slot terbatas, siapa cepat dapat.",
    chipClass:
      "bg-canton-soft text-canton border-canton-muted",
    accentClass: "text-canton",
  },
  CC_MANUAL: {
    code: "CC_MANUAL",
    label: "Token Raffle",
    shortLabel: "CC Raffle",
    isCcToken: true,
    isDual: false,
    isFcfs: false,
    isRaffle: true,
    needsCcAmount: true,
    needsMaxWinners: true,
    defaultClaimFee: 3,
    adminHint:
      "Setelah event: admin Draw Winners → pemenang bayar fee → terima CC. Yang kalah: You Not Lucky.",
    chipClass:
      "bg-canton-soft text-canton border-canton-muted",
    accentClass: "text-canton",
  },
  INVITE_CODE_FCFS: {
    code: "INVITE_CODE_FCFS",
    label: "Waitlist Code FCFS",
    shortLabel: "WAITLIST FCFS",
    isCcToken: false,
    isDual: false,
    isFcfs: true,
    isRaffle: false,
    needsCcAmount: false,
    needsMaxWinners: true,
    defaultClaimFee: 2,
    adminHint:
      "User selesaikan task → bayar 2 CC fee → dapat kode dari pool. Upload kode di Winners.",
    chipClass:
      "bg-violet-500/15 text-violet-200 border-violet-500/25",
    accentClass: "text-violet-300",
  },
  INVITE_CODE_RANDOM: {
    code: "INVITE_CODE_RANDOM",
    label: "Waitlist Code Raffle",
    shortLabel: "WAITLIST RAFFLE",
    isCcToken: false,
    isDual: false,
    isFcfs: false,
    isRaffle: true,
    needsCcAmount: false,
    needsMaxWinners: true,
    defaultClaimFee: 2,
    adminHint:
      "Setelah event: admin Draw Winners → pemenang bayar 2 CC fee → dapat kode. Yang kalah: You Not Lucky.",
    chipClass:
      "bg-canton-soft text-canton border-canton-muted",
    accentClass: "text-canton",
  },
  WAITLIST_EMAIL: {
    code: "WAITLIST_EMAIL",
    label: "Waitlist Email Raffle",
    shortLabel: "Waitlist",
    isCcToken: false,
    isDual: false,
    isFcfs: false,
    isRaffle: true,
    needsCcAmount: false,
    needsMaxWinners: false,
    defaultClaimFee: null,
    adminHint:
      "Task Submit Email + pesan kustom pemenang. Draw di admin; pemenang lihat pesan admin. Offchain.",
    chipClass:
      "bg-cyan-500/12 text-cyan-200 border-cyan-500/25",
    accentClass: "text-cyan-300",
  },
  CC_AND_CODE_RAFFLE: {
    code: "CC_AND_CODE_RAFFLE",
    label: "Token + Code Raffle",
    shortLabel: "CC + Code Raffle",
    isCcToken: true,
    isDual: true,
    isFcfs: false,
    isRaffle: true,
    needsCcAmount: true,
    needsMaxWinners: true,
    defaultClaimFee: 5,
    adminHint:
      "Satu event gabungan: admin draw pemenang → pemenang bayar 5 CC fee → dapat CC reward + invite code.",
    chipClass:
      "bg-gradient-to-r from-canton-soft to-violet-500/15 text-canton border-canton-muted",
    accentClass: "text-canton",
  },
};

// ═══════════════════════════════════════════════════════════════
// 2. getRewardConfig() — resolve with legacy fallback
// ═══════════════════════════════════════════════════════════════

/** Map legacy DB codes to active codes. */
const LEGACY_MAP: Record<LegacyRewardCode, ActiveRewardCode> = {
  CC_AND_INVITE: "CC_AND_CODE_RAFFLE",
  INVITE_CODE: "INVITE_CODE_RANDOM",
};

/**
 * Resolve reward config for any reward type string.
 * Handles legacy codes and unknown values (falls back to CC_ONLY).
 */
export function getRewardConfig(
  rewardType: RewardType | string | undefined | null,
): RewardConfig {
  const rt = (rewardType ?? "CC_ONLY") as string;

  // Direct match on active types
  if (rt in REWARD_CONFIGS) {
    return REWARD_CONFIGS[rt as ActiveRewardCode];
  }

  // Legacy fallback
  if (rt in LEGACY_MAP) {
    return REWARD_CONFIGS[LEGACY_MAP[rt as LegacyRewardCode]];
  }

  // Unknown → CC_ONLY
  return REWARD_CONFIGS.CC_ONLY;
}

/**
 * Normalize any reward type string to an active code.
 * Used for comparisons where you need the canonical code.
 */
export function normalizeRewardCode(
  rewardType: RewardType | string | undefined | null,
): ActiveRewardCode {
  return getRewardConfig(rewardType).code;
}

// ═══════════════════════════════════════════════════════════════
// 3. getQuestMeta() — derived UI state
// ═══════════════════════════════════════════════════════════════

/** Icon hint for components to pick the right lucide icon or CC logo. */
export type RewardIconKind = "cc" | "ticket" | "sparkles" | "trophy";

export interface RewardDisplay {
  /** Which icon category to show */
  iconKind: RewardIconKind;
  /** Primary reward line (e.g. "10 CC / Winners", "1 Code / Winners") */
  primaryText: string;
  /** Secondary info (e.g. "500 CC Reward Pool") */
  secondaryText: string | null;
  /** Pool label for metric strip */
  poolLabel: string;
}

export interface SlotInfo {
  /** FCFS-style (limited slots, first-come) */
  isFcfs: boolean;
  /** Raffle-style (admin draws winners) */
  isRaffle: boolean;
  /** Max winners / total slots */
  max: number;
  /** Slots taken (FCFS: claimed; raffle: drawn) */
  used: number;
  /** Remaining available */
  left: number;
  /** All slots taken */
  full: boolean;
  /** Percentage filled (0–100) */
  pct: number;
  /** Low slots warning (≤1 left for FCFS) */
  warn: boolean;
  /** Formatted label (e.g. "3/10", "Full Claimed") */
  filledLabel: string;
}

export interface MetricItem {
  key: string;
  label: string;
  value: string;
  iconKind: RewardIconKind | "zap" | "users" | "ticket";
  /** Use CC logo instead of icon */
  useCcLogo?: boolean;
  accent?: string;
  muted?: boolean;
}

export type CtaVariant = "primary" | "secondary" | "success" | "muted" | "dashed";

export interface QuestMeta {
  /** Resolved reward config */
  config: RewardConfig;
  /** Display values for reward section */
  rewardDisplay: RewardDisplay;
  /** Slot/winner info */
  slots: SlotInfo;
  /** Whether user has participated */
  hasParticipated: boolean;
  /** Quest can be opened (ACTIVE or ENDED) */
  canOpen: boolean;
  /** User blocked from joining (slots full + not participated + ACTIVE) */
  joinBlocked: boolean;
  /** CTA button label */
  ctaLabel: string;
  /** CTA button variant */
  ctaVariant: CtaVariant;
  /** Metric items for card/sidebar strips */
  metrics: MetricItem[];
  /** Whether to show a progress bar */
  showProgress: boolean;
  /** Progress bar data (if showProgress) */
  progressBar: { used: number; max: number; pct: number; warn: boolean } | null;
}

/** Resolve all derived UI state for a quest. */
export function getQuestMeta(
  quest: Quest,
  userProgress?: UserProgress | null,
): QuestMeta {
  const config = getRewardConfig(quest.rewardType);
  const summary = quest.campaignSummary ?? null;

  // ── Slot calculation ──────────────────────────────────────────
  const slotsMax = summary?.maxWinners ?? quest.maxWinners ?? 0;
  const slotsLeft = summary?.remainingSlots ?? 0;
  const winnersDrawn = summary?.slotsTaken ?? 0;

  // Determine if this quest uses FCFS or raffle style
  const isDrawCcRaffle =
    config.code === "CC_MANUAL" || Boolean(summary?.requiresDrawCcClaim);
  const isCodeFcfs = config.code === "INVITE_CODE_FCFS";
  const effectiveFcfs = isDrawCcRaffle
    ? false
    : isCodeFcfs
      ? true
      : config.isFcfs || (summary?.requiresFcfsClaim ?? false);
  const effectiveRaffle = !effectiveFcfs && config.isRaffle;

  const slotsUsed = effectiveFcfs
    ? fcfsSlotsTaken(slotsLeft, slotsMax)
    : winnersDrawn;
  const slotsFull = effectiveFcfs && isFcfsSlotsFull(slotsLeft, slotsMax);
  const slotsPct =
    slotsMax > 0 ? Math.round((slotsUsed / slotsMax) * 100) : 0;
  const slotsWarn = effectiveFcfs && slotsLeft <= 1 && !slotsFull;

  const slots: SlotInfo = {
    isFcfs: effectiveFcfs,
    isRaffle: effectiveRaffle,
    max: slotsMax,
    used: slotsUsed,
    left: effectiveFcfs ? Math.max(0, slotsMax - slotsUsed) : slotsMax - slotsUsed,
    full: slotsFull,
    pct: slotsPct,
    warn: slotsWarn,
    filledLabel: effectiveFcfs
      ? formatFcfsSlotsFilled(slotsLeft, slotsMax, "Full Claimed")
      : winnersDrawn > 0
        ? `${winnersDrawn}/${slotsMax}`
        : slotsMax > 0
          ? `${slotsMax} max`
          : "—",
  };

  // ── Participation ─────────────────────────────────────────────
  const participated = hasParticipatedInQuest(quest, userProgress);

  // ── Can open / join blocked ───────────────────────────────────
  const canOpen =
    quest.status === "ACTIVE" ||
    quest.status === "ENDED" ||
    (slotsFull && participated);
  const joinBlocked =
    slotsFull && !participated && quest.status === "ACTIVE";

  // ── CTA ───────────────────────────────────────────────────────
  let ctaLabel: string;
  let ctaVariant: CtaVariant;

  if (joinBlocked) {
    ctaLabel = "Full Claimed";
    ctaVariant = "muted";
  } else if (quest.status === "ENDED") {
    ctaLabel = "View";
    ctaVariant = "secondary";
  } else if (quest.status === "COMING_SOON") {
    ctaLabel = "Opens soon";
    ctaVariant = "dashed";
  } else if (
    userProgress?.completedQuestIds?.includes(quest.id)
  ) {
    ctaLabel = "Quest complete";
    ctaVariant = "success";
  } else if (participated && slotsFull) {
    ctaLabel = "View my quest";
    ctaVariant = "primary";
  } else {
    ctaLabel = "Join quest";
    ctaVariant = "primary";
  }

  // ── Reward display ────────────────────────────────────────────
  const iconKind = resolveIconKind(config);
  const poolLabel = formatPoolTotalLabel(
    summary?.poolTotalCc ?? null,
    quest.rewardPool,
  );

  let primaryText: string;
  let secondaryText: string | null = null;

  if (config.isDual) {
    // CC + Code
    primaryText =
      quest.rewardCc > 0
        ? `${quest.rewardCc} CC + 1 Code`
        : "CC + 1 Code";
    if (summary?.poolTotalCc && summary.poolTotalCc > 0) {
      secondaryText = `${summary.poolTotalCc} CC Reward Pool`;
    }
  } else if (config.isCcToken && quest.rewardCc > 0) {
    primaryText = `${quest.rewardCc} CC / Winners`;
    if (summary?.poolTotalCc && summary.poolTotalCc > 0) {
      secondaryText = `${summary.poolTotalCc} CC Reward Pool`;
    }
  } else if (
    config.code === "INVITE_CODE_FCFS" ||
    config.code === "INVITE_CODE_RANDOM"
  ) {
    primaryText = "1 Code / Winners";
    secondaryText = null;
  } else {
    // WAITLIST_EMAIL or CC with 0 rewardCc
    primaryText = poolLabel !== "—" ? poolLabel : "Reward";
    secondaryText = null;
  }

  const rewardDisplay: RewardDisplay = {
    iconKind,
    primaryText,
    secondaryText,
    poolLabel,
  };

  // ── Metrics ───────────────────────────────────────────────────
  const metrics = buildMetrics(config, quest, summary, slots);

  // ── Progress bar ──────────────────────────────────────────────
  const showFcfsProgress =
    effectiveFcfs && summary != null && slotsMax > 0 && !slotsFull;
  const showRaffleProgress =
    effectiveRaffle && slotsMax > 0 && winnersDrawn > 0;
  const showProgress = showFcfsProgress || showRaffleProgress;

  const progressBar = showProgress
    ? {
        used: slotsUsed,
        max: slotsMax,
        pct: slotsPct,
        warn: slotsWarn,
      }
    : null;

  return {
    config,
    rewardDisplay,
    slots,
    hasParticipated: participated,
    canOpen,
    joinBlocked,
    ctaLabel,
    ctaVariant,
    metrics,
    showProgress,
    progressBar,
  };
}

// ── Helpers ───────────────────────────────────────────────────

function resolveIconKind(config: RewardConfig): RewardIconKind {
  if (config.isCcToken) return "cc";
  if (
    config.code === "INVITE_CODE_FCFS" ||
    config.code === "INVITE_CODE_RANDOM"
  )
    return "ticket";
  if (config.code === "WAITLIST_EMAIL") return "sparkles";
  return "trophy";
}

function buildMetrics(
  config: RewardConfig,
  quest: Quest,
  summary: QuestCampaignSummary | null,
  slots: SlotInfo,
): MetricItem[] {
  const items: MetricItem[] = [];

  // Pool total (always show if meaningful)
  const poolLabel = formatPoolTotalLabel(
    summary?.poolTotalCc ?? null,
    quest.rewardPool,
  );
  const showPool = poolLabel !== "—" || (summary?.poolTotalCc ?? 0) > 0;

  if (config.isDual) {
    // CC + Code Raffle: pool + max winners
    if (showPool) {
      items.push({
        key: "pool",
        label: "Reward Pool",
        value: poolLabel,
        iconKind: "cc",
        useCcLogo: true,
        accent: "text-canton",
      });
    }
    if (slots.max > 0) {
      items.push({
        key: "winners",
        label: "Max Winners",
        value: String(slots.max),
        iconKind: "users",
        accent: "text-canton",
      });
    } else {
      items.push({
        key: "fee",
        label: "Claim Fee",
        value: `${config.defaultClaimFee ?? 5} CC`,
        iconKind: "zap",
        accent: "text-amber-300",
      });
    }
    return items;
  }

  // FCFS slots
  if (slots.isFcfs && slots.max > 0 && summary != null) {
    items.push({
      key: "fcfs",
      label: "FCFS slots",
      value: slots.filledLabel,
      iconKind: "zap",
      accent: slots.full ? undefined : "text-canton",
      muted: slots.full,
    });
  }

  // Raffle winners
  if (slots.isRaffle && slots.max > 0) {
    items.push({
      key: "winners",
      label: "Winners",
      value: slots.filledLabel,
      iconKind: "users",
      accent: config.accentClass,
    });
  }

  // Pool (non-dual)
  if (showPool) {
    items.push({
      key: "pool",
      label: "Reward Pool",
      value: poolLabel,
      iconKind: "users",
      accent: config.accentClass,
    });
  }

  // Codes remaining (paid invite codes)
  if (
    summary?.codesRemaining != null &&
    config.code !== "INVITE_CODE_FCFS" &&
    summary.requiresPaidInviteClaim
  ) {
    items.push({
      key: "codes",
      label: "Codes",
      value: `${summary.codesRemaining} invite codes left`,
      iconKind: "ticket",
    });
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════
// 4. validateQuestForm() — admin form validation
// ═══════════════════════════════════════════════════════════════

export interface QuestFormData {
  title?: string;
  org?: string;
  description?: string;
  rewardType?: string;
  rewardCc?: number | string;
  maxWinners?: number | string | null;
  claimFeeCc?: number | string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface FormError {
  field: string;
  message: string;
}

/** Validate admin quest form data. Returns empty array if valid. */
export function validateQuestForm(data: QuestFormData): FormError[] {
  const errors: FormError[] = [];
  const config = getRewardConfig(data.rewardType);

  // Required fields
  if (!data.title?.trim()) {
    errors.push({ field: "title", message: "Campaign title is required." });
  }
  if (!data.org?.trim()) {
    errors.push({ field: "org", message: "Organization is required." });
  }
  if (!data.description?.trim()) {
    errors.push({ field: "description", message: "Description is required." });
  }

  // CC amount
  const cc = Number(data.rewardCc) || 0;
  if (config.needsCcAmount && cc <= 0) {
    errors.push({
      field: "rewardCc",
      message: "CC amount must be greater than 0 for this reward type.",
    });
  }

  // Max winners
  const maxW =
    data.maxWinners === null || data.maxWinners === undefined || data.maxWinners === ""
      ? null
      : Number(data.maxWinners);
  if (config.needsMaxWinners) {
    if (maxW === null || !Number.isFinite(maxW) || maxW < 1) {
      errors.push({
        field: "maxWinners",
        message: "Set max winners / FCFS slots (at least 1).",
      });
    }
  }

  // Date validation
  if (data.startsAt && data.endsAt) {
    const start = new Date(data.startsAt).getTime();
    const end = new Date(data.endsAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
      errors.push({
        field: "endsAt",
        message: "End date/time must be after start date/time.",
      });
    }
  }

  return errors;
}

// ═══════════════════════════════════════════════════════════════
// 5. getActiveRewardTypes() — admin form picker options
// ═══════════════════════════════════════════════════════════════

export interface RewardTypeOption {
  code: ActiveRewardCode;
  label: string;
  hint: string;
  defaultClaimFee: number | null;
}

/** 6 active reward types for the admin form picker. No legacy types. */
export function getActiveRewardTypes(): RewardTypeOption[] {
  const order: ActiveRewardCode[] = [
    "CC_ONLY",
    "CC_MANUAL",
    "INVITE_CODE_FCFS",
    "INVITE_CODE_RANDOM",
    "WAITLIST_EMAIL",
    "CC_AND_CODE_RAFFLE",
  ];

  return order.map((code) => {
    const cfg = REWARD_CONFIGS[code];
    return {
      code: cfg.code,
      label: cfg.label,
      hint: cfg.adminHint,
      defaultClaimFee: cfg.defaultClaimFee,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// Re-exports for convenience
// ═══════════════════════════════════════════════════════════════

/** Check if a reward type code is a legacy code that needs fallback. */
export function isLegacyRewardCode(code: string): boolean {
  return code === "CC_AND_INVITE" || code === "INVITE_CODE";
}

/** Get the active code a legacy code maps to. Returns input if not legacy. */
export function resolveLegacyCode(code: string): ActiveRewardCode {
  if (code in LEGACY_MAP) {
    return LEGACY_MAP[code as LegacyRewardCode];
  }
  if (code in REWARD_CONFIGS) {
    return code as ActiveRewardCode;
  }
  return "CC_ONLY";
}
