import { ListChecks } from "lucide-react";
import { FeaturedQuestCarouselDynamic } from "@/components/landing/featured-quest-carousel-dynamic";
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
        title="Live campaigns"
        description="Open a project, finish its tasks, then claim your reward."
        align="center"
        className="mb-8 md:mb-10"
      />

      {live.length === 0 ? (
        <div className="mx-auto max-w-md rounded-2xl border border-dashed border-[var(--border)] px-6 py-12 text-center">
          <ListChecks className="mx-auto h-7 w-7 text-[var(--muted-foreground)]" aria-hidden />
          <p className="mt-4 font-semibold text-[var(--foreground)]">No campaigns live</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Check back later.</p>
          <div className="mt-6">
            <LaunchAppButton size="lg" />
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <FeaturedQuestCarouselDynamic quests={quests} />
        </div>
      )}
    </LandingSection>
  );
}
