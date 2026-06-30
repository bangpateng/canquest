import { CanQuestLogo } from "@/components/ui/canquest-logo";
import { LaunchAppButton } from "@/components/landing/launch-app-button";
import { LandingShell } from "@/components/landing/landing-shell";

/**
 * Minimal sticky header: logo + Launch App only.
 *
 * The section-anchor nav (Lock / App / Wallet) was removed when the landing
 * page was consolidated to 5 sections — the page reads top-to-bottom without
 * needing jump links, so the header stays clean.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-[var(--background)]/80 backdrop-blur-xl">
      <LandingShell className="flex h-16 items-center justify-between gap-4">
        <div className="flex shrink-0 items-center">
          <CanQuestLogo size="md" href="/" />
        </div>

        <div className="flex shrink-0 items-center">
          <LaunchAppButton />
        </div>
      </LandingShell>
    </header>
  );
}
