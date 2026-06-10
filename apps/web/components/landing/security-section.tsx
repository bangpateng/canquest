import { Lock, Server, Shield } from "lucide-react";
import { LandingShell } from "@/components/landing/landing-shell";
import { SectionHeader } from "@/components/landing/section-header";

const items = [
  { icon: Server, title: "Network isolation", body: "Validators and ledger API stay on dedicated metal. SSH tunnels for dev; production peers over private connectivity." },
  { icon: Lock, title: "Abuse resistance", body: "Anti-sybil heuristics, captcha-ready APIs, replay protection on chain-adjacent actions, and audit trails." },
];

export function SecuritySection() {
  return (
    <section id="security" className="border-b border-[var(--border)] py-12 md:py-14">
      <LandingShell>
        <SectionHeader eyebrow="Trust" title="Security-first operations" description="Separate validator infrastructure from customer-facing surfaces." />
        <div className="grid gap-6 md:grid-cols-2">
          {items.map((item) => { const Icon = item.icon; return (
            <div key={item.title} className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--primary)]/10"><Icon className="h-5 w-5 text-[var(--primary)]" /></div>
              <h3 className="mt-4 text-base font-semibold text-[var(--foreground)]">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">{item.body}</p>
            </div>
          );})}
        </div>
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-5 py-3.5 text-sm text-[var(--muted-foreground)]">
          <Shield className="h-5 w-5 shrink-0 text-[var(--primary)]" />
          <span>Enterprise deployments can route admin actions through separate VPCs—same product surface, stricter perimeter.</span>
        </div>
      </LandingShell>
    </section>
  );
}