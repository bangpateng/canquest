import type { Metadata } from "next";
import { DocsLayout } from "@/components/docs/docs-layout";
import {
  CardGroup,
  DocsCard,
  DocsHeader,
  DocsLink,
  DocsPager,
  DocsSection,
  Lead,
  UL,
} from "@/components/docs/docs-primitives";
import { Callout } from "@/components/docs/callout";
import { LaunchAppButton } from "@/components/landing/launch-app-button";

export const metadata: Metadata = {
  title: "Docs — CanQuest",
  description:
    "How CanQuest works: a Canton-native quest and wallet platform connecting ecosystem projects with verified early users.",
  alternates: { canonical: "/docs" },
};

export default function DocsPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="CanQuest"
        subtitle="A Canton-native quest and wallet platform connecting ecosystem projects with verified early users — not a farming platform."
      />

      <DocsSection title="What is CanQuest">
        <p>
          <Lead>CanQuest</Lead> is a growth layer for Canton Network ecosystem
          projects. It connects partner projects with verified early users and
          rewards genuine on-chain activity.
        </p>
        <p>The dapp has six menus, all driven by one verified Canton wallet:</p>
        <UL>
          <li><Lead>Overview</Lead> — your dashboard: balances, active quests, leaderboard snapshot.</li>
          <li><Lead>Wallet</Lead> — your Canton party ID: balances, send, receive, swap, lock.</li>
          <li><Lead>Earn</Lead> — partner campaigns (CC, invite codes, waitlist slots).</li>
          <li><Lead>Quests</Lead> — daily and on-chain tasks that earn points.</li>
          <li><Lead>Leaderboard</Lead> — rank by net points.</li>
          <li><Lead>Activity</Lead> — full transaction history with explorer links.</li>
        </UL>
        <Callout type="note" title="Verified against the live code">
          These docs reflect what the dapp can do <em>today</em>, verified
          against the live codebase — not a roadmap. Anything listed as
          &ldquo;coming soon&rdquo; is clearly marked.
        </Callout>
      </DocsSection>

      <DocsSection title="Two-sided value">
        <p>
          <Lead>For users:</Lead> early access to ecosystem projects, often
          before they are widely known, plus a verified on-chain standing. CC
          rewards are a bonus, not the headline.
        </p>
        <p>
          <Lead>For partner projects:</Lead> a ready-made growth channel that
          delivers verified, active early users — not passive airdrop claimants
          or bot farms. Launch campaigns in days, not months.
        </p>
        <p>
          See <DocsLink slug="campaigns">Campaigns for partners</DocsLink> to
          learn how to run one.
        </p>
      </DocsSection>

      <DocsSection title="Canton-native">
        <p>
          CanQuest is built directly on the Canton Network. Identity is
          party-based — one verified human gets one Canton party ID. Value
          moves through Canton&apos;s native token standard (CIP-56):
        </p>
        <UL>
          <li><Lead>CC (Amulet)</Lead> — the native unit of Canton Network. Used for locks, quest fees, and rewards.</li>
          <li><Lead>USDCx</Lead> — a transferable token you can send P2P and swap against CC.</li>
          <li><Lead>LockedAmulet</Lead> — CC locked for a term to reach the &ldquo;Full access&rdquo; tier; returned in full at expiry.</li>
        </UL>
        <p>
          Read more in <DocsLink slug="concepts">Core concepts</DocsLink>.
        </p>
      </DocsSection>

      <DocsSection title="Get started" className="border-b-0">
        <p>
          Ready to dive in? Create an account, set up your wallet, and start
          earning in a few minutes.
        </p>
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
