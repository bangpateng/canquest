import { LandingImage } from "@/components/landing/landing-image";
import { TokenBadge } from "@/components/landing/token-badge";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

export function CantonSection() {
  return (
    <LandingSection id="canton" variant="muted" className="border-b-0">
      <SectionHeader
        eyebrow="Wallet"
        title="Balance & identity on the Canton ledger"
        align="center"
        className="mb-8 md:mb-10"
      />
      <div className="mb-10 flex items-center justify-center gap-2">
        <TokenBadge symbol="CC" />
        <TokenBadge
          symbol="USDCx"
          className="border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
        />
      </div>
      <LandingImage
        src="/landing/canton-wallet-light.svg"
        alt="CanQuest Canton wallet showing party ID and CC balance"
        ratio="4/3"
        className="mx-auto max-w-2xl"
      />
    </LandingSection>
  );
}
