/** Shared types for the Quest system — mirrors the Prisma / NestJS API shapes. */

export type QuestStatus = "ACTIVE" | "COMING_SOON" | "ENDED";
export type SubmissionStatus = "PENDING" | "VERIFIED" | "REJECTED";

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
}

export interface Quest {
  id: string;
  title: string;
  org: string;
  orgSlug: string;
  description: string;
  banner: string;
  /** Uploaded or external image URL shown on cards; omit to use gradient `banner`. */
  bannerImageUrl?: string | null;
  logoUrl?: string | null;
  rewardCc: number;
  rewardPool: string;
  deadline: string | null;
  status: QuestStatus;
  tags: string[];
  createdAt: string;
  tasks: QuestTask[];
}

export interface QuestSubmission {
  id: string;
  taskId: string;
  status: SubmissionStatus;
  proof: string | null;
  submittedAt: string;
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
      "bg-amber-500/15 text-amber-900 dark:text-amber-300 border border-amber-500/25",
  },
  ENDED: {
    label: "Ended",
    className:
      "bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)]",
  },
};

/** Tag chips layered on banner photos — readable on busy backgrounds */
export const QUEST_BANNER_TAG_PILL =
  "rounded-lg bg-white/95 px-3 py-1 text-[10px] font-semibold leading-tight text-neutral-900 shadow-md ring-2 ring-white/95 backdrop-blur-sm sm:text-xs dark:bg-neutral-950/90 dark:text-neutral-100 dark:ring-white/70";

export type QuestTaskType =
  | "twitter_follow"
  | "twitter_retweet"
  | "telegram_join"
  | "discord_join"
  | "submit_email"
  | "submit_canton_address"
  | "visit_website"
  | "quiz_choice";
