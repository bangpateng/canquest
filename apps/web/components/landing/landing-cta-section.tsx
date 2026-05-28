import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingSection } from "@/components/landing/landing-section";

export function LandingCtaSection() {
  return (
    <LandingSection className="border-b-0">
      <div className="relative overflow-hidden rounded-3xl border border-[var(--primary)]/20 bg-[var(--card)] px-6 py-12 text-center sm:px-12 sm:py-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(ellipse 70% 80% at 50% 0%, rgb(var(--canton-rgb) / 0.15), transparent)",
          }}
          aria-hidden
        />
        <div className="relative">
          <h2 className="type-display text-2xl font-bold tracking-tight sm:text-3xl">
            Open CanQuest
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-[var(--muted-foreground)] sm:text-base">
            Free to join — pick up where you left off or start with the carousel above.
          </p>
          <div className="mt-8 flex justify-center">
            <LaunchAppButton
              size="lg"
              showArrow
              className="rounded-full px-10 font-bold shadow-[0_0_32px_rgb(var(--canton-rgb)/0.25)]"
            />
          </div>
        </div>
      </div>
    </LandingSection>
  );
}
