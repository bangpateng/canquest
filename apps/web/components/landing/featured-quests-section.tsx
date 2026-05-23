import { fetchFeaturedQuests } from "@/lib/server/featured-quests";
import { FeaturedCampaigns } from "@/components/landing/featured-campaigns";

export async function FeaturedQuestsSection() {
  const quests = await fetchFeaturedQuests(20);
  return <FeaturedCampaigns quests={quests} />;
}
