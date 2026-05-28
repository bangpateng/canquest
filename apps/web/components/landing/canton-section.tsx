import { Wallet } from "lucide-react";
import { CcRewardLogo } from "@/components/app/cc-reward-logo";
import { LandingSection } from "@/components/landing/landing-section";
import { cn } from "@/lib/utils";

const points = [
  "Create a Canton party and link it to your CanQuest account",
  "CC from partner Earn campaigns (FCFS claim) and Spin Reward land in your wallet",
  "Complete social missions on campaigns — rewards use the partner project name",
  "Send and receive CC with CIP-56 preapproval when enabled",
];

export function CantonSection() {
  return (
    <LandingSection id="canton" variant="muted" className="border-b-0">
      <div className="glass-card overflow-hidden rounded-3xl ring-1 ring-[var(--border)]">
        <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center md:gap-10 lg:p-10">
          <div className="text-center md:text-left">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-canton-subtle ring-1 ring-[var(--primary)]/20 md:mx-0">
              <CcRewardLogo size={32} />
            </span>
            <p className="type-eyebrow-brand mt-6">Wallet</p>
            <h2 className="type-display mt-2 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
              Built on Canton
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted-foreground)] sm:text-base">
              CanQuest uses the Canton Network for party identity and CC transfers — the same
              wallet you manage in the app.
            </p>
          </div>

          <ul className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/20 p-5 sm:p-6">
            {points.map((line) => (
              <li key={line} className="flex gap-3 text-sm leading-relaxed text-[var(--muted-foreground)]">
                <span
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-canton"
                  aria-hidden
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div
          className={cn(
            "flex items-center justify-center gap-2 border-t border-[var(--border)] bg-[var(--muted)]/15 px-4 py-3 text-xs text-[var(--muted-foreground)]",
          )}
        >
          <Wallet className="h-3.5 w-3.5 shrink-0 text-canton" aria-hidden />
          Canton party · CC balance · On-chain send & receive
        </div>
      </div>
    </LandingSection>
  );
}
