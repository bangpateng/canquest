import { getCampaignRewardHeadline } from "@/lib/campaign-reward";
import {
  isCampaignSocialTaskType,
  resolveQuestProjectName,
  type Quest,
} from "@/lib/quest-types";

/** Copy and metrics for landing partner campaign cards (aligned with Earn detail). */
export function getLandingCampaignDisplay(quest: Quest) {
  const socialTasks = quest.tasks.filter((t) => isCampaignSocialTaskType(t.type));
  const socialTaskCount = socialTasks.length;
  const questPoints = quest.tasks.reduce((sum, t) => sum + t.points, 0);
  const rewardHeadline = getCampaignRewardHeadline(
    quest,
    quest.campaignSummary?.poolTotalCc ?? null,
  );
  const projectName = resolveQuestProjectName(quest);

  return {
    socialTaskCount,
    taskCount: quest.tasks.length,
    questPoints,
    rewardPrimary: rewardHeadline.primary,
    rewardSecondary: rewardHeadline.secondary,
    projectName,
  };
}
