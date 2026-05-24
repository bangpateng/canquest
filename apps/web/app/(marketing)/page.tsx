import { AppOverviewSection } from "@/components/landing/app-overview-section";
import { CantonSection } from "@/components/landing/canton-section";
import { FeaturedQuestsSection } from "@/components/landing/featured-quests-section";
import { LandingHero } from "@/components/landing/hero";

export default function MarketingHomePage() {
  return (
    <>
      <LandingHero />
      <FeaturedQuestsSection />
      <AppOverviewSection />
      <CantonSection />
    </>
  );
}
