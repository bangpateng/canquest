import {
  formatCcPerWinners,
  formatPoolTotalLabel,
} from "@/lib/campaign-reward";
import {
  filterCampaignParticipantTasks,
  type Quest,
} from "@/lib/quest-types";

/** Copy and metrics for landing partner campaign cards (aligned with Earn detail). */
export function getLandingCampaignDisplay(quest: Quest) {
  const socialTasks = filterCampaignParticipantTasks(quest.tasks);
  const socialTaskCount = socialTasks.length;
  const questPoints = socialTasks.reduce((sum, t) => sum + t.points, 0);
  const poolLabel = formatPoolTotalLabel(
    quest.campaignSummary?.poolTotalCc ?? null,
    quest.rewardPool,
  );
  const ccPerWinners =
    quest.rewardCc > 0 ? formatCcPerWinners(quest.rewardCc) : null;

  return {
    socialTaskCount,
    questPoints,
    poolLabel,
    ccPerWinners,
  };
}
