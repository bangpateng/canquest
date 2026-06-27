import { BarChart3, Fingerprint, ShieldCheck, Zap } from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

const items = [
  {
    icon: Fingerprint,
    title: "Canton-native identity",
    body: "Party binding, preapproval-ready flows, and session controls designed around the ledger — not bolted on after the fact.",
  },
  {
    icon: Zap,
    title: "Verified quest engine",
    body: "Server-verified tasks, weighted points, and auditable completions. The browser never decides the outcome of a reward.",
  },
  {
    icon: BarChart3,
    title: "Real-user leaderboards",
    body: "Weekly, monthly, and all-time standings among verified humans — fast rankings backed by Redis, not a flooded leaderboard of bots.",
  },
  {
    icon: ShieldCheck,
    title: "Reward integrity",
    body: "Reward pools, treasury fees, and winner draws use secure server randomness with ledger-aligned records you can trust.",
  },
];

export function PlatformFeatures() {
  return (
    <LandingSection id="features" variant="muted">
      <SectionHeader
        eyebrow="Product"
        title="Depth under a calm surface"
        align="center"
        description="A serious financial-network UX: restraint, clarity, and interfaces that scale from pilot to production."
        className="mb-8 md:mb-10"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.title}
              className="group glass-card glass-card-hover rounded-2xl p-6 ring-1 ring-[var(--border)]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15 transition-shadow group-hover:shadow-[0_0_24px_rgb(var(--canton-rgb)/0.12)]">
                <Icon className="h-5 w-5 text-canton" />
              </div>
              <h3 className="type-section-title mt-4">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                {f.body}
              </p>
            </div>
          );
        })}
      </div>
    </LandingSection>
  );
}
