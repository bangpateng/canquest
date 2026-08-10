import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  DocsHeader,
  DocsLink,
  DocsPager,
  DocsSection,
  DocsTable,
  Lead,
  UL,
} from "@/components/docs/docs-primitives";
import { Callout } from "@/components/docs/callout";

export const metadata: Metadata = {
  title: "Earn — daily tasks & points — CanQuest Docs",
  description:
    "The Earn hub: daily check-ins with streak bonuses, server-verified social tasks, quizzes, points redemption, and partner campaigns.",
  alternates: { canonical: "/docs/earn" },
};

export default function EarnPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Earn — daily tasks & points"
        subtitle="Daily check-ins, server-verified social tasks, quizzes, and points you can spend on campaigns or redeem for rewards."
      />

      <DocsSection title="Two menus, one points system">
        <p>
          CanQuest splits activity across two menus that share the same points
          balance:
        </p>
        <UL>
          <li>
            <Lead>Quests</Lead> — CanQuest&apos;s own daily/social/on-chain
            tasks. This is where you <em>earn</em> points.
          </li>
          <li>
            <Lead>Earn</Lead> — partner campaigns. This is where you{" "}
            <em>spend</em> points (or lock CC) to join and claim rewards.
          </li>
        </UL>
        <Callout type="note" title="Wallet required">
          You need a Canton wallet before you can submit any Earn task or
          redeem points. See{" "}
          <DocsLink slug="getting-started">Getting started</DocsLink>.
        </Callout>
      </DocsSection>

      <DocsSection title="Daily tasks">
        <p>
          The Quests hub contains recurring tasks managed by the CanQuest team.
          Several reset every 24 hours.
        </p>
        <DocsTable
          head={["Task", "How it verifies"]}
          rows={[
            ["Daily check-in", "Tap once a day; drives streak milestones."],
            ["X follow / retweet", "Server-verified via the Twitter API (not honor-system)."],
            ["Telegram channel / group", "Click + auto-verify."],
            ["Discord join", "Click + auto-verify."],
            ["Quiz (Yes/No)", "Correct answer earns points; wrong = 0."],
            ["Quiz (A/B/C/D)", "Correct answer earns points; wrong = 0."],
          ]}
        />
      </DocsSection>

      <DocsSection title="Streaks">
        <p>
          Check in once per day to build a streak. You earn bonus points at
          consecutive-day milestones. Milestone days, points per milestone, and
          the base per-check-in reward are all configurable by the team.
        </p>
        <Callout type="tip" title="Typical milestones">
          Streak bonuses commonly land at <Lead>1, 3, 5, 7, 14, 15, and 30</Lead>{" "}
          consecutive days. The exact schedule can change as the team tunes the
          reward curve.
        </Callout>
      </DocsSection>

      <DocsSection title="Redeeming points">
        <p>
          Points are spendable. The redemption catalog is managed by the team
          and can include:
        </p>
        <UL>
          <li><Lead>Points → CC</Lead> — points converted to CC sent to your wallet.</li>
          <li><Lead>Points → waitlist / invite code</Lead> — access to a partner or feature.</li>
          <li><Lead>Points → other rewards</Lead> — custom rewards added by the team.</li>
        </UL>
        <p>
          Points are also spent on campaign entry when a campaign&apos;s gate
          requires them — see{" "}
          <DocsLink slug="quests">entry gate modes</DocsLink>.
        </p>
      </DocsSection>

      <DocsSection title="Partner campaigns (Earn menu)" className="border-b-0">
        <p>
          Under <Lead>Earn</Lead> you browse partner campaigns by status
          (Active, Coming soon, Ended), open one to read its rules, then
          complete the social tasks and claim your reward.
        </p>
        <UL>
          <li>Tasks are social only: follow on X, retweet, join Telegram or Discord. Tasks unlock one at a time.</li>
          <li>Each campaign sets its own gate: free, a CC lock, points, or either a CC lock or points.</li>
          <li>Claim types and fees are documented on the <DocsLink slug="quests">Quests</DocsLink> page.</li>
        </UL>
        <p>
          Running a campaign yourself? See{" "}
          <DocsLink slug="campaigns">Campaigns for partners</DocsLink>.
        </p>
      </DocsSection>

      <DocsPager currentSlug="earn" />
    </DocsLayout>
  );
}
