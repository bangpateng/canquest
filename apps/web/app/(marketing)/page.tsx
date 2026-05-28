import { AppOverviewSection } from "@/components/landing/app-overview-section";
import { CantonSection } from "@/components/landing/canton-section";
import { FeaturedQuestsSection } from "@/components/landing/featured-quests-section";
import { LandingHero } from "@/components/landing/hero";
import { LandingCtaSection } from "@/components/landing/landing-cta-section";
import { LandingHowItWorks } from "@/components/landing/landing-how-it-works";
import { LandingMarquee } from "@/components/landing/landing-marquee";

export default function MarketingHomePage() {
  return (
    <>
      <LandingHero />
      <LandingMarquee />
      <LandingHowItWorks />
      <FeaturedQuestsSection />
      <AppOverviewSection />
      <CantonSection />
      <LandingCtaSection />
    </>
  );
}
