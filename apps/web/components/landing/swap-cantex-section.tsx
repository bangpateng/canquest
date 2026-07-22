import { ArrowLeftRight } from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

/** Swap / Cantex highlight section.
 * Swap is live for CC ↔ USDCX; more pairs rolling out. Marked "Beta" to avoid
 * over-promising on pair breadth. Mirrors the glass-card / canton-subtle
 * idioms used by lock-section.tsx. */
export function SwapCantexSection() {
  return (
    <LandingSection id="swap" variant="muted">
      <SectionHeader
        eyebrow="Cantex"
        title="Swap CC for tokens, on-network"
        align="center"
        description="Trade CC for supported tokens directly through the Cantex decentralized exchange — without leaving CanQuest. More CC movement, more on-chain activity."
        className="mb-8 md:mb-10"
      />

      <div className="glass-card glass-card-hover mx-auto max-w-2xl rounded-2xl p-6 ring-1 ring-[var(--border)] sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15">
            <ArrowLeftRight className="h-5 w-5 text-canton" aria-hidden />
          </span>
          {/* Beta badge — light-theme variant of the "Coming soon" pill pattern
              used in token-card.tsx / wallet-actions.tsx. */}
          <span className="rounded-full border border-canton-muted bg-canton-subtle px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-canton">
            Beta
          </span>
        </div>

        <h3 className="type-section-title mt-4">Swap inside your wallet</h3>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
          Swap quotes preview fees and slippage up front, settlement runs through
          Canton transfer primitives, and any failed delivery is tracked for
          reconciliation — non-custodial end to end. Every swap moves CC
          on-network for a real reason.
        </p>

        <p className="mt-5 flex items-start gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/30 px-4 py-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
          <ArrowLeftRight
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-canton"
            aria-hidden
          />
          <span>
            Currently <strong className="font-medium text-[var(--foreground)]">CC ↔ USDCX</strong>.
            More pairs coming soon.
          </span>
        </p>
      </div>
    </LandingSection>
  );
}
