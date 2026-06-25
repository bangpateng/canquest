/** Task types shown and required for partner campaigns (Earn menu). */
export function isCampaignSocialTaskType(type: string): boolean {
  const t = type === 'telegram_join' ? 'telegram_channel' : type;
  return (
    t === 'twitter_follow' ||
    t === 'twitter_retweet' ||
    t === 'telegram_channel' ||
    t === 'telegram_group' ||
    t === 'discord_join'
  );
}

export function filterCampaignParticipantTasks<T extends { type: string }>(
  tasks: T[],
): T[] {
  return tasks.filter((t) => isCampaignSocialTaskType(t.type));
}
