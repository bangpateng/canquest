import { CcRewardLogo } from "@/components/app/campaign/cc-reward-logo";
import { LandingSection } from "@/components/landing/landing-section";

export function CantonSection() {
  return (
    <LandingSection id="canton" variant="muted" className="border-b-0">
      <div className="mx-auto max-w-lg text-center">
        <CcRewardLogo size={36} className="mx-auto" />
        <h2 className="type-display mt-5 text-xl font-bold sm:text-2xl">
          One Canton wallet, per person
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          Your party ID is your on-chain home on Canton. It holds your CC balance and powers
          the lock.
        </p>
        <ul className="mt-6 space-y-2 text-left text-sm text-[var(--muted-foreground)]">
          <li className="flex gap-2">
            <span className="text-canton" aria-hidden>
              ·
            </span>
            One party ID per verified human (invite-gated)
          </li>
          <li className="flex gap-2">
            <span className="text-canton" aria-hidden>
              ·
            </span>
            On-chain balance, not a separate points counter
          </li>
        </ul>
      </div>
    </LandingSection>
  );
}
