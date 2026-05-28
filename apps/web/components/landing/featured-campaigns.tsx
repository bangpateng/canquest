import { ListChecks } from "lucide-react";
import { FeaturedQuestCarouselDynamic } from "@/components/landing/featured-quest-carousel-dynamic";
import { LandingCampaignGrid } from "@/components/landing/landing-campaign-grid";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import type { Quest } from "@/lib/quest-types";

export function FeaturedCampaigns({ quests }: { quests: Quest[] }) {
  const live = quests.filter(
    (q) => q.status === "ACTIVE" || q.status === "COMING_SOON",
  );

  return (
    <LandingSection id="campaigns" variant="muted">
      <SectionHeader
        eyebrow="Earn"
        title="Partner campaigns"
        description="Real projects on Canton — complete social missions, earn points, and claim CC. Each campaign uses the partner’s branding from admin."
        align="center"
        className="max-w-2xl"
      />

      {live.length === 0 ? (
        <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 px-6 py-14 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-[var(--muted-foreground)]" aria-hidden />
          <p className="type-subsection-title mt-4">No live campaigns yet</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Sign in and open Earn, or check back when new partner quests go live.
          </p>
          <div className="mt-6 flex justify-center">
            <LaunchAppButton size="lg" showArrow />
          </div>
        </div>
      ) : (
        <div className="space-y-10 md:space-y-12">
          <FeaturedQuestCarouselDynamic quests={quests} />
          <LandingCampaignGrid quests={quests} />
        </div>
      )}
    </LandingSection>
  );
}
