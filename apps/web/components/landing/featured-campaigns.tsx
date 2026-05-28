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
        title="Live partner drops"
        description="Each card is a separate project — open one to see tasks, slots, and how rewards are paid out."
        align="center"
        className="max-w-2xl"
      />

      {live.length === 0 ? (
        <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 px-6 py-14 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-[var(--muted-foreground)]" aria-hidden />
          <p className="type-subsection-title mt-4">Nothing live right now</p>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            New drops are added from admin — check back soon or open the app to browse all.
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
