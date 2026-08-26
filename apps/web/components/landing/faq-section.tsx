import { ChevronDown } from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

/**
 * FAQ — native <details>/<summary>, no JS.
 *
 * Rule: only cover topics NOT already explained by other sections.
 */
const faqs = [
  {
    q: "Do I lose my CC when I lock it?",
    a: "No. Your CC stays in your own wallet via AmuletRules, and returns in full when you unlock. There's only a small holding fee while it's locked — the principal is never deducted.",
  },
  {
    q: "What kind of rewards can I claim from quests?",
    a: "Four types: First-come-first-served (slots that can run out), Raffle (admin draws winners), Invite code (reveals a partner code after the fee), and CC + Code raffle (a combined CC + code draw). Each campaign picks which type it offers.",
  },
  {
    q: "Is there a fee to send CC or USDCx?",
    a: "Yes. Both use Canton's CIP-56 transfer. A small portion of the amount is routed to the treasury party as a platform fee. The fee is shown in the preview before you confirm.",
  },
  {
    q: "Which swap pairs are available?",
    a: "Currently CC ↔ USDCx. More pairs are coming — it's still in Beta.",
  },
  {
    q: "Who controls my wallet?",
    a: "You do — CanQuest is fully non-custodial. Your private key is generated in your browser and encrypted with your passphrase. It never leaves your device, and every on-chain action (send, lock, swap, claim) requires your signature. Even we cannot move your funds.",
  },
  {
    q: "What if I forget my passphrase?",
    a: "Restore your wallet with your Backup Key — the 64-character code you saved during setup — and set a new passphrase. If both the passphrase and the Backup Key are lost, the wallet cannot be recovered by anyone, including us. That is what true self-custody means.",
  },
  {
    q: "How do I get an invite code?",
    a: "From the CanQuest team or a partner. Wallet creation is gated by an invite code under a daily quota. Without a code, you can't create a party ID yet.",
  },
  {
    q: "How does CanQuest prevent bots and farming?",
    a: "One party ID per verified human, enforced through invite-gated sign-ups — so bot farming is costly here. Quests, points, and reward draws are decided server-side with an audit trail, never in the browser, so they can't be manipulated client-side.",
  },
];

export function FaqSection() {
  return (
    <LandingSection id="faq">
      <SectionHeader
        eyebrow="FAQ"
        title="Frequently asked questions"
        align="center"
        className="mb-8 md:mb-10"
      />
      <div className="mx-auto max-w-3xl divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/40">
        {faqs.map((item) => (
          <details key={item.q} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--primary)]/5 sm:px-6 sm:text-base">
              {item.q}
              <ChevronDown
                className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="px-5 pb-5 text-sm leading-relaxed text-[var(--muted-foreground)] sm:px-6">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </LandingSection>
  );
}
