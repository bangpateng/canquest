import { CcRewardLogo } from "@/components/app/cc-reward-logo";
import { LandingSection } from "@/components/landing/landing-section";

export function CantonSection() {
  return (
    <LandingSection id="canton" variant="muted" className="border-b-0">
      <div className="mx-auto max-w-lg text-center">
        <CcRewardLogo size={36} className="mx-auto" />
        <h2 className="type-display mt-5 text-xl font-bold sm:text-2xl">Canton wallet</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          Your party ID holds CC from campaign claims and spin prizes. Send to other users when
          you are ready.
        </p>
        <ul className="mt-6 space-y-2 text-left text-sm text-[var(--muted-foreground)]">
          <li className="flex gap-2">
            <span className="text-canton" aria-hidden>
              ·
            </span>
            One wallet for every reward type
          </li>
          <li className="flex gap-2">
            <span className="text-canton" aria-hidden>
              ·
            </span>
            On-chain balance, not a separate points balance
          </li>
          <li className="flex gap-2">
            <span className="text-canton" aria-hidden>
              ·
            </span>
            Preapproval available for faster claims
          </li>
        </ul>
      </div>
    </LandingSection>
  );
}
