import { ArrowRight, Compass, Gift, Lock, Sparkles } from "lucide-react";
import { LandingImage } from "@/components/landing/landing-image";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

const FLOW = [
  {
    icon: Compass,
    title: "Browse campaigns",
    body: "See the latest partner campaigns available in Earn.",
  },
  {
    icon: Lock,
    title: "Check eligibility",
    body: "Each campaign shows the minimum CC lock or points to redeem required to join.",
  },
  {
    icon: Sparkles,
    title: "Lock & join",
    body: "Lock CC to reach the tier, then join the campaign in Earn.",
  },
  {
    icon: Gift,
    title: "Claim your reward",
    body: "Partner access code, CC, or USDCx.",
  },
];

export function LockSection() {
  return (
    <LandingSection id="lock">
      <SectionHeader
        eyebrow="How it works"
        title="Lock CC, buka kampanye"
        align="center"
        className="mb-10 md:mb-14"
      />

      {/* ── 4-step flow ── */}
      <ol className="relative mb-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* connecting line behind the cards (desktop) */}
        <div
          className="pointer-events-none absolute inset-x-[10%] top-[68px] hidden h-px lg:block"
          style={{
            background:
              "linear-gradient(to right, transparent, rgb(var(--canton-rgb) / 0.3), rgb(var(--canton-rgb) / 0.3), transparent)",
          }}
          aria-hidden
        />
        {FLOW.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.title} className="relative">
              <article className="glass-card glass-card-hover gradient-hairline relative h-full overflow-hidden rounded-2xl p-6 ring-1 ring-[var(--border)]">
                {/* ghost step number */}
                <span
                  className="pointer-events-none absolute -right-2 -top-4 select-none text-7xl font-extrabold leading-none text-[var(--foreground)] opacity-[0.04]"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/20">
                    <Icon className="h-5 w-5 text-canton" aria-hidden />
                  </span>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-canton-muted bg-canton-subtle text-[11px] font-bold text-canton">
                    {i + 1}
                  </span>
                </div>
                <h3 className="type-section-title mt-5">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  {step.body}
                </p>
              </article>
              {i < FLOW.length - 1 ? (
                <span
                  className="absolute -right-4 top-1/2 hidden -translate-y-1/2 rounded-full border border-[var(--border)] bg-[var(--background)] p-1 text-canton lg:block"
                  aria-hidden
                >
                  <ArrowRight className="h-4 w-4" />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Screenshot slot — public/landing/how-it-works.svg */}
      <LandingImage
        src="/landing/how-it-works.svg"
        alt="Browse and join partner campaigns in the CanQuest app"
        ratio="4/3"
        className="mx-auto max-w-2xl"
      />
    </LandingSection>
  );
}
