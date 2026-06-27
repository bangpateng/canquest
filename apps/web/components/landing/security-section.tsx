import { Fingerprint, ShieldCheck, UserCheck } from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

const items = [
  {
    icon: UserCheck,
    title: "One real human, one account",
    body: "Registration runs email OTP verification plus a Cloudflare Turnstile captcha, and throwaway email domains are blocked at the door — so creating farms of fake accounts is costly and slow.",
  },
  {
    icon: Fingerprint,
    title: "Invite-gated Canton wallet",
    body: "Each person gets exactly one on-chain party ID, and wallet creation requires a team invite code under a daily quota. You can't spin up unlimited wallets to farm rewards.",
  },
  {
    icon: ShieldCheck,
    title: "Server-verified, not client-trusted",
    body: "Task completion, points, and reward draws are decided on the server with structured audit trails — never by the browser. Global rate limiting and replay protection guard every sensitive action.",
  },
];

export function SecuritySection() {
  return (
    <LandingSection id="integrity">
      <SectionHeader
        eyebrow="Integrity"
        title="Anti-sybil by design"
        align="center"
        description="We protect the reward pool from bots and multi-account farming, so genuine contributors are the ones who benefit."
        className="mb-8 md:mb-10"
      />
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.title}
              className="glass-card glass-card-hover rounded-2xl p-6 ring-1 ring-[var(--border)]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-canton-subtle ring-1 ring-[var(--primary)]/15">
                <Icon className="h-5 w-5 text-canton" />
              </div>
              <h3 className="type-section-title mt-5">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted-foreground)]">
                {item.body}
              </p>
            </div>
          );
        })}
      </div>
    </LandingSection>
  );
}
