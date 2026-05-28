import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingSection } from "@/components/landing/landing-section";

export function LandingCtaSection() {
  return (
    <LandingSection className="border-b-0">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-10 text-center sm:py-12">
        <h2 className="text-xl font-bold sm:text-2xl">Ready to start?</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted-foreground)]">
          Sign in and open your first campaign.
        </p>
        <div className="mt-6 flex justify-center">
          <LaunchAppButton size="lg" showArrow className="rounded-full px-8" />
        </div>
      </div>
    </LandingSection>
  );
}
