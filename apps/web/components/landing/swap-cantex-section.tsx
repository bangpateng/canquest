import { ArrowLeftRight } from "lucide-react";
import { LandingImage } from "@/components/landing/landing-image";
import { TokenBadge, TokenLogo } from "@/components/landing/token-badge";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

/** Swap highlight section. CC ↔ USDCx live. */
export function SwapCantexSection() {
  return (
    <LandingSection id="swap" variant="muted">
      <SectionHeader
        eyebrow="Swap"
        title="Tukar CC ↔ USDCx"
        align="center"
        className="mb-10 md:mb-12"
      />

      {/* Supported pairs strip — uses real token logos */}
      <div className="mb-10 flex flex-wrap items-center justify-center gap-2">
        <TokenBadge symbol="CC" />
        <ArrowLeftRight className="h-3 w-3 text-[var(--muted-foreground)]" />
        <TokenBadge
          symbol="USDCx"
          className="border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
        />
        <span className="rounded-full border border-canton-muted bg-canton-subtle px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-canton">
          Beta
        </span>
        {/* CBTC — coming soon */}
        <span className="mx-2 hidden h-4 w-px bg-[var(--border)] sm:inline-block" aria-hidden />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs font-semibold text-[var(--muted-foreground)] opacity-70">
          <TokenLogo symbol="CBTC" size={16} />
          CBTC
        </span>
        <span className="rounded-full border border-[var(--border)] bg-[var(--muted)]/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
          Coming soon
        </span>
      </div>

      <LandingImage
        src="/landing/swap.svg"
        alt="Swap CC for USDCx inside the CanQuest wallet"
        ratio="4/3"
        className="mx-auto max-w-2xl"
      />
    </LandingSection>
  );
}
