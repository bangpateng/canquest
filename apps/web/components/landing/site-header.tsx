import { CanQuestLogo } from "@/components/ui/canquest-logo";
import { LandingShell } from "@/components/landing/landing-shell";

/**
 * Minimal sticky header: logo only.
 *
 * The Launch App CTA appears once on the page, in the hero (the primary
 * action) — a second copy here made the top of the page feel doubled.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-[var(--background)]/80 backdrop-blur-xl">
      <LandingShell className="flex h-16 items-center gap-4">
        <CanQuestLogo size="md" href="/" />
      </LandingShell>
    </header>
  );
}
