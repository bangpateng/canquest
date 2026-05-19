import { BarChart3, Fingerprint, ShieldCheck, Zap } from "lucide-react";

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
    body: "Spin pools, treasury fees, and winner selection use secure server randomness with ledger-aligned records.",
  },
];

export function PlatformFeatures() {
  return (
    <section id="features" className="border-b border-[var(--border)] py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-12 max-w-2xl">
          <h2 className="font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight sm:text-4xl">
            Platform depth, calm surface
          </h2>
          <p className="mt-3 text-[var(--muted-foreground)]">
            Everything you expect from a serious financial network UX: restraint,
            clarity, and interfaces that scale from pilot to production.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          {items.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 transition-colors hover:border-[var(--foreground)]/10"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)]/12 text-[var(--foreground)]">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-[family-name:var(--font-space)] text-lg font-semibold">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
