import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  DocsHeader,
  DocsLink,
  DocsPager,
  DocsSection,
  Lead,
  OL,
  UL,
} from "@/components/docs/docs-primitives";

export const metadata: Metadata = {
  title: "Campaigns for partners — CanQuest Docs",
  description:
    "How to run a campaign on CanQuest: reward types, entry gates, and the lifecycle from create to close.",
  alternates: { canonical: "/docs/campaigns" },
};

export default function CampaignsPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Campaigns for partners"
        subtitle="Run a campaign on CanQuest: pick a reward type and entry gate, draw winners, and distribute rewards."
      />

      <DocsSection title="Reward types">
        <p>
          Pick how participants are rewarded. The claim flow and default fees
          are explained on the <DocsLink slug="quests">Quests</DocsLink> page.
        </p>
        <UL>
          <li><Lead>Token FCFS</Lead> — first-come-first-served CC from a limited pool.</li>
          <li><Lead>Token raffle</Lead> — admin-drawn winners receive CC.</li>
          <li><Lead>Invite / access code</Lead> — a code revealed after the claim.</li>
          <li><Lead>CC + code raffle</Lead> — drawn winners get CC and a code together.</li>
          <li><Lead>Waitlist email</Lead> — submit email for a raffle spot.</li>
        </UL>
        <p>
          Fees are defaults and can be overridden per campaign — including{" "}
          <code className="rounded bg-[var(--muted)] px-1 font-mono text-[0.85em]">0</code>{" "}
          for a free claim.
        </p>
      </DocsSection>

      <DocsSection title="Entry gates">
        <p>
          Each campaign sets how a verified user qualifies. A CC lock is the
          strongest signal; points reward active users; free is the lowest
          barrier.
        </p>
        <UL>
          <li><Lead>CC or points</Lead> — either works (default).</li>
          <li><Lead>CC only</Lead> — lock CC to join.</li>
          <li><Lead>Points only</Lead> — redeem earned points to join.</li>
          <li><Lead>None</Lead> — any verified user can join for free.</li>
        </UL>
        <p>
          Because joining costs something, farming stops being worth it. More
          on that in <DocsLink slug="anti-sybil">Verification &amp; anti-sybil</DocsLink>.
        </p>
      </DocsSection>

      <DocsSection title="Running a campaign">
        <OL>
          <li><Lead>Create</Lead> — name, reward type, gate, tasks, and reward pool, in the admin panel.</li>
          <li><Lead>Activate</Lead> — verified users can now see it in Earn and complete tasks.</li>
          <li><Lead>Draw winners</Lead> — raffle types only; only drawn winners can claim.</li>
          <li><Lead>Distribute</Lead> — FCFS and code claims settle on claim; raffle CC is sent to winners.</li>
          <li><Lead>Close</Lead> when it&apos;s done.</li>
        </OL>
      </DocsSection>

      <DocsSection title="Get started" className="border-b-0">
        <p>
          To launch a campaign, reach us via the{" "}
          <a
            href="/cooperation#partner-form"
            className="text-canton underline-offset-2 hover:underline"
          >
            partnership form
          </a>
          .
        </p>
      </DocsSection>

      <DocsPager currentSlug="campaigns" />
    </DocsLayout>
  );
}
