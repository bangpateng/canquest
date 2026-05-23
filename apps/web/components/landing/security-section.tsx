import { Lock, Server, Shield } from "lucide-react";
import { LandingShell } from "@/components/landing/landing-shell";
import { SectionHeader } from "@/components/landing/section-header";

const items = [
  {
    icon: Server,
    title: "Network isolation",
    body: "Validators and ledger API stay on dedicated metal. SSH tunnels for dev; production peers over private connectivity—never a public RPC spray.",
  },
  {
    icon: Lock,
    title: "Abuse resistance",
    body: "Anti-sybil heuristics, captcha-ready APIs, replay protection on chain-adjacent actions, and structured audit trails for every sensitive decision.",
  },
];

export function SecuritySection() {
  return (
    <section id="security" className="border-b border-[var(--border)] py-12 md:py-14">
      <LandingShell>
        <SectionHeader
          eyebrow="Trust"
          title="Security-first operations"
          description="Separate validator infrastructure from customer-facing surfaces. Rate limits, JWT rotation, device signals, and observability are first-class—not stretch goals."
        />
        <div className="grid gap-6 md:grid-cols-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="group glass-card glass-card-hover rounded-2xl p-8 ring-1 ring-[var(--border)]"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15">
                  <Icon className="h-5 w-5 text-canton" />
                </div>
                <h3 className="type-section-title mt-5">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  {item.body}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--muted)]/30 px-5 py-3.5 text-sm text-[var(--muted-foreground)]">
          <Shield className="h-5 w-5 shrink-0 text-canton" />
          <span>
            Enterprise deployments can route admin actions through separate VPCs and
            hardware-backed signing—same product surface, stricter perimeter.
          </span>
        </div>
      </LandingShell>
    </section>
  );
}
