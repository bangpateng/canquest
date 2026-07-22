import { AppOverviewSection } from "@/components/landing/app-overview-section";
import { CantonSection } from "@/components/landing/canton-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { LandingHero } from "@/components/landing/hero";
import { LockSection } from "@/components/landing/lock-section";
import { SwapCantexSection } from "@/components/landing/swap-cantex-section";

export default function MarketingHomePage() {
  return (
    <>
      <LandingHero />
      <LockSection />
      <CantonSection />
      <AppOverviewSection />
      <SwapCantexSection />
      <FeaturesSection />
    </>
  );
}
