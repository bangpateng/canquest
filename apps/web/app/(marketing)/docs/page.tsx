import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  CardGroup,
  DocsCard,
  DocsHeader,
  DocsPager,
  DocsSection,
  Lead,
  UL,
} from "@/components/docs/docs-primitives";
import { LaunchAppButton } from "@/components/landing/launch-app-button";

export const metadata: Metadata = {
  title: "Docs — CanQuest",
  description:
    "How CanQuest works: a quest and wallet platform on the Canton Network.",
  alternates: { canonical: "/docs" },
};

export default function DocsPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="CanQuest"
        subtitle="A quest and wallet platform on the Canton Network. One verified account gets one wallet, earns points from real activity, and joins partner campaigns."
      />

      <DocsSection title="What is CanQuest">
        <p>
          <Lead>CanQuest</Lead> is a quest platform built on the Canton Network.
          You do tasks to earn points, lock CC to unlock partner campaigns, and
          claim rewards. CC rewards are a bonus — the main point is early access
          to ecosystem projects.
        </p>
        <p>The dapp has six menus, all tied to one Canton wallet:</p>
        <UL>
          <li><Lead>Overview</Lead> — your dashboard.</li>
          <li><Lead>Wallet</Lead> — send, receive, swap, and lock CC and tokens.</li>
          <li><Lead>Quests</Lead> — daily and on-chain tasks that earn points.</li>
          <li><Lead>Earn</Lead> — partner campaigns (CC, invite codes, waitlist slots).</li>
          <li><Lead>Leaderboard</Lead> — rank by net points.</li>
          <li><Lead>Activity</Lead> — transaction history with explorer links.</li>
        </UL>
      </DocsSection>

      <DocsSection title="Get started" className="border-b-0">
        <p>Create an account, set up your wallet, and start earning in a few minutes.</p>
        <div className="pt-1">
          <LaunchAppButton size="lg" className="rounded-full" />
        </div>

        <div className="mt-8">
          <CardGroup>
            <DocsCard title="Getting started" href="/docs/getting-started">
              Sign up, create your wallet, and earn your first points.
            </DocsCard>
            <DocsCard title="Wallet — CC, tokens & swap" href="/docs/wallet">
              Send, receive, swap, and lock CC and tokens.
            </DocsCard>
            <DocsCard title="Quests & reward claims" href="/docs/quests">
              Daily tasks, points, and the four reward claim types.
            </DocsCard>
            <DocsCard title="Campaigns for partners" href="/docs/campaigns">
              Run a campaign: reward types, entry gates, distribution.
            </DocsCard>
          </CardGroup>
        </div>

        <DocsPager currentSlug="" />
      </DocsSection>
    </DocsLayout>
  );
}
