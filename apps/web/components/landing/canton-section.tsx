import { Wallet } from "lucide-react";
import { LandingShell } from "@/components/landing/landing-shell";
import { SectionHeader } from "@/components/landing/section-header";

const points = [
  "Create a Canton party and link it to your CanQuest account",
  "CC from partner Earn campaigns (FCFS claim) and Spin Reward land in your wallet",
  "Complete social missions on campaigns — rewards use the partner project name",
  "Send and receive CC with CIP-56 preapproval when enabled",
];

export function CantonSection() {
  return (
    <section id="canton" className="relative py-12 md:py-14">
      <div className="absolute inset-0 bg-[var(--muted)]/40" />
      <LandingShell className="relative">
        <div className="glass-card mx-auto max-w-3xl rounded-2xl p-8 ring-1 ring-[var(--border)] md:p-10">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-canton-subtle ring-1 ring-[var(--primary)]/20">
              <Wallet className="h-6 w-6 text-canton" />
            </span>
            <div className="mt-6">
              <SectionHeader
                eyebrow="Wallet"
                title="Built on Canton"
                description="CanQuest uses the Canton Network for party identity and CC transfers — the same wallet you manage in the app."
                align="center"
              />
            </div>
          </div>
          <ul className="mt-8 space-y-3 text-left text-sm text-[var(--muted-foreground)] sm:mx-auto sm:max-w-md">
            {points.map((line) => (
              <li key={line} className="flex gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-canton" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </LandingShell>
    </section>
  );
}
