import { CheckCircle2, MousePointerClick, Wallet } from "lucide-react";
import { LandingReveal } from "@/components/landing/landing-reveal";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";
import type { LucideIcon } from "lucide-react";

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: MousePointerClick,
    title: "Choose a drop",
    body: "Open any live card — rules, art, and reward type are set per project.",
  },
  {
    icon: CheckCircle2,
    title: "Pass verification",
    body: "Tasks are checked server-side; your wallet links when a step needs it.",
  },
  {
    icon: Wallet,
    title: "Balance updates",
    body: "CC from claims and spin prizes posts to the party tied to your profile.",
  },
];

export function LandingHowItWorks() {
  return (
    <LandingSection id="how">
      <LandingReveal>
        <SectionHeader
          eyebrow="Flow"
          title="Three beats to a payout"
          description="Same rhythm whether the drop is FCFS, raffle, or hub-only points first."
          align="center"
        />

        <ol className="relative grid gap-8 md:grid-cols-3 md:gap-6">
          <div
            className="pointer-events-none absolute top-8 hidden h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent md:left-[16%] md:right-[16%] md:block"
            aria-hidden
          />
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="relative flex flex-col items-center text-center">
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-canton-subtle text-lg font-bold tabular-nums text-canton ring-1 ring-[var(--primary)]/25">
                  {index + 1}
                </span>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--muted)]/40 ring-1 ring-[var(--border)]">
                  <Icon className="h-5 w-5 text-canton" aria-hidden />
                </span>
                <h3 className="type-section-title mt-4">{step.title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--muted-foreground)]">
                  {step.body}
                </p>
              </li>
            );
          })}
        </ol>
      </LandingReveal>
    </LandingSection>
  );
}
