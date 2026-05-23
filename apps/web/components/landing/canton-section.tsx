import Link from "next/link";
import { ExternalLink, Layers } from "lucide-react";
import { LandingShell } from "@/components/landing/landing-shell";
import { SectionHeader } from "@/components/landing/section-header";

const refs = [
  {
    label: "Digital Asset build docs (3.5)",
    href: "https://docs.digitalasset.com/build/3.5/index.html",
  },
  {
    label: "Application development reference",
    href: "https://docs.digitalasset.com/build/3.5/reference/app-dev/index.html",
  },
  {
    label: "Smart contracts reference",
    href: "https://docs.digitalasset.com/build/3.5/reference/smart-contracts/index.html",
  },
];

export function CantonSection() {
  return (
    <section id="canton" className="relative border-b border-[var(--border)] py-12 md:py-14">
      <div className="absolute inset-0 bg-[var(--muted)]/40" />
      <LandingShell className="relative flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-16">
        <div className="flex-1">
          <SectionHeader
            eyebrow="Infrastructure"
            title="Powered by Canton"
            description="CanQuest aligns with Digital Asset ledger patterns and DAML module boundaries. Smart contracts evolve in lockstep with official SDK guidance—no fictional custom L2 narratives."
          />
          <ul className="space-y-3 text-sm text-[var(--muted-foreground)]">
            {[
              "Participant-managed parties and Ledger API workflows",
              "Event-driven backends; heavy ledger work never blocks HTTP",
              "Dedicated indexer projects app state off the hot path",
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-canton" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="glass-card flex flex-1 flex-col gap-4 rounded-2xl p-8 ring-1 ring-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-canton-subtle">
              <Layers className="h-5 w-5 text-canton" />
            </span>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--muted-foreground)]">
              Official references
            </p>
          </div>
          <ul className="space-y-3">
            {refs.map((r) => (
              <li key={r.href}>
                <Link
                  className="group inline-flex items-center gap-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:text-canton"
                  href={r.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {r.label}
                  <ExternalLink className="h-3.5 w-3.5 opacity-50 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </LandingShell>
    </section>
  );
}
