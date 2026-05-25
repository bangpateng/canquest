import { ListChecks } from "lucide-react";
import { FeaturedQuestCarouselDynamic } from "@/components/landing/featured-quest-carousel-dynamic";
import { LandingShell } from "@/components/landing/landing-shell";
import { SectionHeader } from "@/components/landing/section-header";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import type { Quest } from "@/lib/quest-types";

export function FeaturedCampaigns({ quests }: { quests: Quest[] }) {
  const live = quests.filter(
    (q) => q.status === "ACTIVE" || q.status === "COMING_SOON",
  );

  return (
    <section id="campaigns" className="relative border-b border-[var(--border)] py-12 md:py-14">
      <div className="absolute inset-0 bg-[var(--muted)]/30" />
      <LandingShell className="relative">
        <SectionHeader
          eyebrow="Earn"
          title="Partner campaigns"
          description="Live and upcoming partner programs from the Earn menu. Open a campaign to complete missions and claim rewards."
          className="max-w-2xl"
        />

        {live.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 px-6 py-14 text-center">
            <ListChecks className="mx-auto h-8 w-8 text-[var(--muted-foreground)]" />
            <p className="type-subsection-title mt-4">No live campaigns yet</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Sign in and check the Earn page, or come back when new partner quests go live.
            </p>
            <div className="mt-6 flex justify-center">
              <LaunchAppButton size="lg" showArrow />
            </div>
          </div>
        ) : (
          <FeaturedQuestCarouselDynamic quests={quests} />
        )}
      </LandingShell>
    </section>
  );
}
