/** Campaign social links — mirrors API `quest-social-links.util.ts`. */

export const QUEST_SOCIAL_PLATFORMS = [
  "twitter",
  "discord",
  "telegram",
  "website",
  "github",
  "youtube",
  "linkedin",
  "instagram",
  "medium",
] as const;

export type QuestSocialPlatform = (typeof QUEST_SOCIAL_PLATFORMS)[number];

export interface QuestSocialLink {
  platform: QuestSocialPlatform;
  url: string;
}

export const QUEST_SOCIAL_PLATFORM_OPTIONS: {
  value: QuestSocialPlatform;
  label: string;
}[] = [
  { value: "twitter", label: "X (Twitter)" },
  { value: "discord", label: "Discord" },
  { value: "telegram", label: "Telegram" },
  { value: "website", label: "Website" },
  { value: "github", label: "GitHub" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "medium", label: "Medium" },
];

export function emptySocialLinkDraft(): QuestSocialLink {
  return { platform: "twitter", url: "" };
}
