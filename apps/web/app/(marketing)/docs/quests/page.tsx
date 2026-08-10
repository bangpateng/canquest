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
import { InlineCode } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Quests & reward claims — CanQuest Docs",
  description:
    "Daily and on-chain tasks that earn points, the four reward claim types and their fees, and the per-campaign entry gate modes.",
  alternates: { canonical: "/docs/quests" },
};

export default function QuestsPage() {
  return (
    <DocsLayout>
      <DocsHeader
        title="Quests & reward claims"
        subtitle="Daily and on-chain tasks that earn points, the four reward claim types, and the per-campaign entry gates."
      />

      <DocsSection title="The Quests hub">
        <p>
          The <Lead>Quests</Lead> hub is where you earn points from recurring
          activity. Tasks unlock one at a time; several reset every 24 hours so
          you can earn again. Points are spendable — some partner campaigns
          cost points to join — and your balance also drives your leaderboard
          rank.
        </p>
        <p>
          Task types:
        </p>
        <UL>
          <li><Lead>Daily check-in</Lead> — tap once a day for points (resets every 24h).</li>
          <li><Lead>Social</Lead> — follow/retweet on X, join Telegram or Discord (one-time).</li>
          <li><Lead>Quizzes</Lead> — Yes/No or A/B/C/D; the correct answer earns points.</li>
          <li>
            <Lead>On-chain tasks</Lead> — send CC, send USDCx, or swap CC↔USDCx
            a set number of times in 24h (repeatable); or lock CC at a given
            tier (one-time per tier).
          </li>
        </UL>
      </DocsSection>

      <DocsSection title="Reward claim types">
        <p>
          Partner campaigns in <Lead>Earn</Lead> reward you in one of four
          claim flows. Each has a small claim fee in CC (a current default,
          subject to change) that the campaign can override — including setting
          it to zero.
        </p>
        <DocsTable
          head={["Claim flow", "What you get", "Default fee"]}
          rows={[
            [
              "FCFS (first-come-first-served)",
              "A token (CC) from a limited pool — slots fill up in order.",
              "3 CC",
            ],
            [
              "Draw CC (raffle)",
              "A token (CC). Winners are drawn by the admin; you then claim.",
              "3 CC",
            ],
            [
              "Invite / code reveal",
              "A partner invite or access code, revealed after paying the fee.",
              "2 CC",
            ],
            [
              "CC + code raffle",
              "A token (CC) and a code together. Winners are drawn by the admin.",
              "5 CC",
            ],
          ]}
        />
        <Callout type="warning" title="Fees are defaults">
          The fees above are current defaults. A campaign can set a custom fee
          per quest — including <InlineCode>0</InlineCode> to make a claim free.
          The exact fee is always shown before you confirm a claim.
        </Callout>
      </DocsSection>

      <DocsSection title="How a claim works">
        <p>Each claim is atomic and anti-sybil:</p>
        <UL>
          <li>
            <Lead>Reserve your slot</Lead> — recorded on-chain, so one account
            can&apos;t claim twice.
          </li>
          <li>
            <Lead>Pay the fee &amp; receive the reward</Lead> — settle together
            in one transaction.
          </li>
          <li>
            <Lead>Reveal a code</Lead> — for code rewards, the code appears only
            after the fee settles.
          </li>
        </UL>
        <Callout type="note" title="Raffles">
          For raffle campaigns, the project admin draws winners from the
          eligible pool first. Only drawn winners can claim.
        </Callout>
      </DocsSection>

      <DocsSection title="Entry gate modes">
        <p>
          Each campaign sets how a verified user qualifies to participate. The
          mode is chosen per event by the partner.
        </p>
        <DocsTable
          head={["Mode", "What it means"]}
          rows={[
            ["CC or points", "Lock CC or redeem points — either works (default)."],
            ["CC only", "Only locking CC grants access."],
            ["Points only", "Only redeeming earned points grants access."],
            ["None", "No gate; any verified user can join for free."],
          ]}
        />
        <p>
          Read more about why commitment gating matters in{" "}
          <DocsLink slug="anti-sybil">Verification &amp; anti-sybil</DocsLink>.
        </p>
      </DocsSection>

      <DocsSection title="Invite friends" className="border-b-0">
        <p>
          The referral card on the Quests hub shows your invite link and code.
        </p>
        <UL>
          <li>You earn <Lead>points per verified signup</Lead>.</li>
          <li>The friend must verify their email <em>and</em> connect an X account.</li>
          <li>Self-referrals and email-alias farming are blocked automatically.</li>
        </UL>
      </DocsSection>

      <DocsPager currentSlug="quests" />
    </DocsLayout>
  );
}
