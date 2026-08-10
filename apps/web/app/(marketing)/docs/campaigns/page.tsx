import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  DocsHeader,
  DocsLink,
  DocsPager,
  DocsSection,
  DocsTable,
  Lead,
  OL,
  UL,
} from "@/components/docs/docs-primitives";
import { Callout } from "@/components/docs/callout";
import { InlineCode } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Campaigns for partners — CanQuest Docs",
  description:
    "How to run a campaign on CanQuest: reward types, entry gates, raffle draws, reward distribution, and the anti-sybil controls that protect your budget.",
  alternates: { canonical: "/docs/campaigns" },
};

export default function CampaignsPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Campaigns for partners"
        subtitle="Run a campaign on CanQuest: choose a reward type and entry gate, draw winners, and distribute rewards to verified users."
      />

      <DocsSection title="Why run a campaign">
        <p>
          CanQuest is a growth layer for Canton ecosystem projects. A campaign
          delivers <Lead>verified, active early users</Lead> — not passive
          airdrop claimants or bot farms — in days, not months.
        </p>
        <Callout type="note" title="Not a farming platform">
          The product is positioned around early access and verified standing,
          with CC rewards as a bonus. Campaigns that lead with &ldquo;free
          tokens for clicks&rdquo; are a poor fit and perform worse.
        </Callout>
      </DocsSection>

      <DocsSection title="Reward types">
        <p>
          Choose how participants are rewarded. Each type maps to one of the
          claim flows documented on the <DocsLink slug="quests">Quests</DocsLink>{" "}
          page.
        </p>
        <DocsTable
          head={["Reward type", "Delivery", "Default claim fee"]}
          rows={[
            ["Token FCFS", "First-come-first-served CC from a limited pool.", "3 CC"],
            ["Token raffle", "Admin-drawn winners receive CC.", "3 CC"],
            ["Invite / access code", "A code revealed after paying the fee.", "2 CC"],
            ["CC + code raffle", "Drawn winners get CC and a code together.", "5 CC"],
            ["Waitlist email", "Submit email for a raffle spot.", "None"],
          ]}
        />
        <Callout type="warning" title="Fees are configurable">
          The fees above are current defaults and can be overridden per
          campaign — including set to <InlineCode>0</InlineCode> for a free
          claim. Fees discourage frivolous claims and are routed to the
          treasury.
        </Callout>
      </DocsSection>

      <DocsSection title="Entry gates">
        <p>
          The entry gate decides how a verified user qualifies. Pick the mode
          that matches the signal strength you want — a CC lock is the
          strongest commitment; points reward genuine activity; free is the
          lowest barrier.
        </p>
        <DocsTable
          head={["Mode", "Best for"]}
          rows={[
            ["CC or points", "Maximum reach (default) — either commitment works."],
            ["CC only", "Strongest skin-in-the-game; smallest, highest-intent pool."],
            ["Points only", "Reward your existing active community."],
            ["None", "Broad awareness plays; any verified user can join."],
          ]}
        />
      </DocsSection>

      <DocsSection title="Running a campaign">
        <p>
          A typical campaign lifecycle:
        </p>
        <OL>
          <li><Lead>Create</Lead> the campaign in the admin panel — name, reward type, gate, tasks, and reward pool.</li>
          <li><Lead>Activate</Lead> it. Verified users can now see it in Earn and complete tasks.</li>
          <li>
            <Lead>Draw winners</Lead> (raffle types only) from the eligible
            pool when the campaign ends. Only drawn winners can claim.
          </li>
          <li>
            <Lead>Distribute</Lead> rewards — FCFS and code claims settle
            automatically on claim; raffle CC rewards are distributed to
            winners by the team.
          </li>
          <li><Lead>Close</Lead> the campaign when it&apos;s done.</li>
        </OL>
      </DocsSection>

      <DocsSection title="Anti-sybil protects your budget">
        <p>
          Because participants must be verified (invite-gated wallet, email
          OTP) and commit (CC lock or earned points) to join high-value
          campaigns, replicating identities at scale is costly. Your reward
          budget goes to real, engaged users. See{" "}
          <DocsLink slug="anti-sybil">Verification &amp; anti-sybil</DocsLink>.
        </p>
        <UL>
          <li>One verified human → one Canton party ID.</li>
          <li>Social tasks verified server-side (Twitter API), not self-reported.</li>
          <li>Quest outcomes and draws decided server-side with audit trails.</li>
        </UL>
      </DocsSection>

      <DocsSection title="Get started" className="border-b-0">
        <p>
          To launch a campaign, reach the team via the{" "}
          <a
            href="/cooperation#partner-form"
            className="text-canton underline-offset-2 hover:underline"
          >
            partnership form
          </a>
          . Submissions go straight to the team.
        </p>
      </DocsSection>

      <DocsPager currentSlug="campaigns" />
    </DocsLayout>
  );
}
