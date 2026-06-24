import { BarChart3, Fingerprint, ShieldCheck, Zap } from "lucide-react";
import { LandingShell } from "@/components/landing/landing-shell";
import { SectionHeader } from "@/components/landing/section-header";

const items = [
  {
    icon: Fingerprint,
    title: "Canton-native identity",
    body: "Party binding, preapproval-ready flows, and enterprise session controls designed around the ledger—not bolted on.",
  },
  {
    icon: Zap,
    title: "Quest engine",
    body: "Server-verified tasks, weighted points, and auditable completions. The client never decides the outcome.",
  },
  {
    icon: BarChart3,
    title: "Leaderboards & SocialFi",
    body: "Weekly, monthly, and all-time standings with Redis-backed realtime updates—fast without hammering your node.",
  },
  {
    icon: ShieldCheck,
    title: "Reward integrity",
    body: "Reward pools, treasury fees, and winner selection use secure server randomness with ledger-aligned records.",
  },
];

export function PlatformFeatures() {
  return (
    <section id="features" className="border-b border-[var(--border)] py-12 md:py-14">
      <LandingShell>
        <SectionHeader
          eyebrow="Product"
          title="Platform depth, calm surface"
          description="Everything you expect from a serious financial network UX: restraint, clarity, and interfaces that scale from pilot to production."
        />
        <div className="grid gap-6 sm:grid-cols-2">
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
                <h3 className="type-section-title mt-4">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  {f.body}
                </p>
              </div>
            );
          })}
        </div>
      </LandingShell>
    </section>
  );
}
