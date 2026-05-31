import type { Quest } from "@/lib/quest/quest-types";

const DEFAULT_API_ORIGIN = "https://api.canquest.cc";

function apiOrigin(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiUrl) {
    try {
      return new URL(apiUrl).origin;
    } catch {
      /* fall through */
    }
  }
  return process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, "") ?? DEFAULT_API_ORIGIN;
}

/** HTTPS URL via API proxy (avoids broken r2.dev SSL in browsers). */
export function ccRewardLogoApiUrl(): string {
  return `${apiOrigin()}/api/uploads/cc-reward-logo`;
}

function isDirectR2Url(url: string): boolean {
  return /\.r2\.dev\b/i.test(url) || /\.r2\.cloudflarestorage\.com/i.test(url);
}

export function getCcRewardLogoUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_CC_REWARD_LOGO_URL?.trim() ||
    process.env.CC_REWARD_LOGO_URL?.trim() ||
    "";

  if (raw) {
    if (isDirectR2Url(raw) || raw.includes("/quests/C")) {
      return ccRewardLogoApiUrl();
    }
    if (raw.includes("/api/uploads/cc-reward-logo")) {
      return raw;
    }
    return raw;
  }

  return ccRewardLogoApiUrl();
}

/** Earn / campaign quests that pay CC (FCFS, raffle draw, per-winner CC, etc.). */
export function isCcTokenRewardQuest(
  quest: Pick<Quest, "rewardCc" | "rewardType" | "rewardPool">,
): boolean {
  if ((quest.rewardCc ?? 0) > 0) return true;
  const rt = quest.rewardType ?? "";
  if (rt === "CC_ONLY" || rt === "CC_MANUAL" || rt === "CC_AND_INVITE") return true;
  const pool = (quest.rewardPool ?? "").toLowerCase();
  return /\bcc\b/.test(pool) || pool.includes("canton coin");
}
