import { CantonSection } from "@/components/landing/canton-section";
import { FeaturedCampaigns } from "@/components/landing/featured-campaigns";
import { LandingHero } from "@/components/landing/hero";
import { PlatformFeatures } from "@/components/landing/platform-features";
import { SecuritySection } from "@/components/landing/security-section";

export default function MarketingHomePage() {
  return (
    <>
      <LandingHero />
      <FeaturedCampaigns />
      <PlatformFeatures />
      <CantonSection />
      <SecuritySection />
    </>
  );
}
