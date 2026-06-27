import { AppOverviewSection } from "@/components/landing/app-overview-section";
import { CantonSection } from "@/components/landing/canton-section";
import { FeaturedQuestsSection } from "@/components/landing/featured-quests-section";
import { LandingHero } from "@/components/landing/hero";
import { IntegritySection } from "@/components/landing/integrity-section";
import { PlatformFeatures } from "@/components/landing/platform-features";

export default function MarketingHomePage() {
  return (
    <>
      <LandingHero />
      <IntegritySection />
      <FeaturedQuestsSection />
      <AppOverviewSection />
      <CantonSection />
      <PlatformFeatures />
    </>
  );
}
